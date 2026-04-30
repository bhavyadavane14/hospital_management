const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get appointments for a patient
router.get('/:patientId', auth(), (req, res) => {
    try {
        const appointments = db.prepare(`
            SELECT a.*, d.name as doctor_name, n.name as nurse_name
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            LEFT JOIN nurses n ON a.nurse_id = n.id
            WHERE a.patient_id = ?
            ORDER BY a.scheduled_at ASC
        `).all(req.params.patientId);
        res.json(appointments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new appointment
router.post('/', auth(['nurse', 'doctor', 'admin']), (req, res) => {
    const { patient_id, doctor_id, nurse_id, scheduled_at } = req.body;
    
    try {
        db.prepare(`
            INSERT INTO appointments (patient_id, doctor_id, nurse_id, scheduled_at)
            VALUES (?, ?, ?, ?)
        `).run(patient_id, doctor_id, nurse_id || null, scheduled_at);

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patient_id, `New appointment scheduled at ${scheduled_at}`);

        res.json({ message: 'Appointment scheduled' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
