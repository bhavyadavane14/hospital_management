const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get all patients with role-specific isolation and filtering
router.get('/', auth(), (req, res) => {
    const { search, ward, doctor_id, nurse_id, status, specialization, sort_by } = req.query;
    const { role, doctorId, nurseId } = req.session;
    
    let query = `
        SELECT p.*, b.ward, b.bed_number, d.name as doctor_name, n.name as nurse_name 
        FROM patients p
        LEFT JOIN beds b ON p.bed_id = b.id
        LEFT JOIN doctors d ON p.doctor_id = d.id
        LEFT JOIN nurses n ON p.nurse_id = n.id
        WHERE 1=1
    `;
    const params = [];

    // Role-based isolation
    if (role === 'nurse') {
        query += ` AND p.nurse_id = ?`;
        params.push(nurseId);
    } else if (role === 'doctor') {
        query += ` AND p.doctor_id = ?`;
        params.push(doctorId);
    }

    // Filters
    if (status) {
        query += ` AND p.status = ?`;
        params.push(status);
    } else {
        query += ` AND p.status != 'Discharged'`;
    }

    if (search) {
        query += ` AND (p.name LIKE ? OR p.id = ?)`;
        params.push(`%${search}%`, search);
    }

    if (ward) {
        query += ` AND b.ward = ?`;
        params.push(ward);
    }

    if (specialization) {
        query += ` AND d.specialization = ?`;
        params.push(specialization);
    }

    // AOA: Priority Sorting
    if (sort_by === 'severity') {
        query += ` ORDER BY CASE p.severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END ASC, p.admission_time DESC`;
    } else {
        query += ` ORDER BY p.admission_time DESC`;
    }

    try {
        const patients = db.prepare(query).all(...params);
        res.json(patients);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Register new patient - Nurses register, Admins allocate later
router.post('/', auth(['nurse']), (req, res) => {
    const { name, age, gender } = req.body;
    const nurseId = req.session.nurseId;
    
    try {
        const result = db.prepare(`
            INSERT INTO patients (name, age, gender, nurse_id, status) 
            VALUES (?, ?, ?, ?, 'Pending')
        `).run(name, age, gender, nurseId);

        const patientId = result.lastInsertRowid;

        // Log event
        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patientId, 'Patient registered by Nurse. Awaiting bed allocation.');

        res.json({ message: 'Patient registered and awaiting allocation', patientId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update vitals & Automatic Emergency Detection (OS: Interrupt Handling)
router.post('/:id/vitals', auth(['nurse']), (req, res) => {
    const { heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes } = req.body;
    const patientId = req.params.id;
    const io = req.app.get('io');

    const transaction = db.transaction(() => {
        db.prepare(`
            INSERT INTO vitals_logs (patient_id, heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(patientId, heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes);

        // Automatic Emergency Detection Logic
        let severity = 'Normal';
        let alertMessage = '';

        if (heart_rate > 120 || temperature > 102 || bp_systolic < 90 || oxygen_level < 90) {
            severity = 'Critical';
            alertMessage = `CRITICAL ALERT: Abnormal vitals detected. HR: ${heart_rate}, Temp: ${temperature}, O2: ${oxygen_level}%`;
        } else if (heart_rate > 100 || temperature > 100 || oxygen_level < 94) {
            severity = 'Warning';
        }

        db.prepare(`UPDATE patients SET severity = ? WHERE id = ?`).run(severity, patientId);

        if (severity === 'Critical') {
            const patient = db.prepare('SELECT name, doctor_id FROM patients WHERE id = ?').get(patientId);
            
            // Insert alert (OS: Interrupt)
            const alertResult = db.prepare(`
                INSERT INTO alerts (patient_id, doctor_id, message)
                VALUES (?, ?, ?)
            `).run(patientId, patient.doctor_id, alertMessage);

            // Log event
            db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patientId, `EMERGENCY: ${alertMessage}`);

            // Emit real-time alert via Socket.io
            io.to(`doctor_${patient.doctor_id}`).emit('emergencyAlert', {
                alertId: alertResult.lastInsertRowid,
                patientName: patient.name,
                message: alertMessage,
                timestamp: new Date()
            });
        } else {
            db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patientId, 'Vitals updated');
        }

        return severity;
    });

    try {
        const severity = transaction();
        res.json({ message: 'Vitals updated', severity });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual Emergency Alert (Nurse triggers)
router.post('/:id/alert', auth(['nurse']), (req, res) => {
    const { message } = req.body;
    const patientId = req.params.id;
    const io = req.app.get('io');

    try {
        const patient = db.prepare('SELECT name, doctor_id FROM patients WHERE id = ?').get(patientId);
        if (!patient || !patient.doctor_id) {
            return res.status(400).json({ error: 'Patient not assigned to a doctor yet' });
        }

        const alertMessage = message || `MANUAL ALERT: Nurse requested immediate assistance for ${patient.name}`;
        
        db.prepare(`UPDATE patients SET severity = 'Critical' WHERE id = ?`).run(patientId);
        
        const alertResult = db.prepare(`
            INSERT INTO alerts (patient_id, doctor_id, message)
            VALUES (?, ?, ?)
        `).run(patientId, patient.doctor_id, alertMessage);

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patientId, `NURSE ALERT: ${alertMessage}`);

        io.to(`doctor_${patient.doctor_id}`).emit('emergencyAlert', {
            alertId: alertResult.lastInsertRowid,
            patientName: patient.name,
            message: alertMessage,
            timestamp: new Date()
        });

        res.json({ message: 'Manual alert sent to doctor' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Discharge Patient
router.post('/:id/discharge', auth(['doctor', 'admin']), (req, res) => {
    const patientId = req.params.id;
    
    const transaction = db.transaction(() => {
        const patient = db.prepare('SELECT bed_id FROM patients WHERE id = ?').get(patientId);
        
        // Update patient status
        db.prepare(`UPDATE patients SET status = 'Discharged', bed_id = NULL WHERE id = ?`).run(patientId);
        
        // Free up bed
        if (patient.bed_id) {
            db.prepare(`UPDATE beds SET status = 'Available' WHERE id = ?`).run(patient.bed_id);
        }

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patientId, 'Patient discharged from hospital');
    });

    try {
        transaction();
        res.json({ message: 'Patient discharged successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get patient details and timeline (AOA: Analysis of history)
router.get('/:id', auth(), (req, res) => {
    try {
        const patient = db.prepare(`
            SELECT p.*, b.ward, b.bed_number, d.name as doctor_name, n.name as nurse_name 
            FROM patients p
            LEFT JOIN beds b ON p.bed_id = b.id
            LEFT JOIN doctors d ON p.doctor_id = d.id
            LEFT JOIN nurses n ON p.nurse_id = n.id
            WHERE p.id = ?
        `).get(req.params.id);

        if (!patient) return res.status(404).json({ error: 'Patient not found' });

        const vitals = db.prepare(`SELECT * FROM vitals_logs WHERE patient_id = ? ORDER BY timestamp DESC`).all(req.params.id);
        const logs = db.prepare(`SELECT * FROM patient_logs WHERE patient_id = ? ORDER BY timestamp DESC`).all(req.params.id);
        const checkups = db.prepare(`SELECT * FROM checkups WHERE patient_id = ? ORDER BY timestamp DESC`).all(req.params.id);

        res.json({ patient, vitals, logs, checkups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
