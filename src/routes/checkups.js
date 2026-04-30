const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get checkups for a patient
router.get('/:patientId', auth(), (req, res) => {
    try {
        const checkups = db.prepare(`
            SELECT c.*, n.name as nurse_name, d.name as doctor_name
            FROM checkups c
            JOIN nurses n ON c.nurse_id = n.id
            LEFT JOIN doctors d ON c.doctor_id = d.id
            WHERE c.patient_id = ?
            ORDER BY c.timestamp DESC
        `).all(req.params.patientId);
        res.json(checkups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new checkup record
router.post('/', auth(['nurse', 'doctor']), (req, res) => {
    const { patient_id, notes, findings, doctor_id } = req.body;
    const nurseId = req.session.nurseId;
    
    try {
        db.prepare(`
            INSERT INTO checkups (patient_id, nurse_id, doctor_id, notes, findings)
            VALUES (?, ?, ?, ?, ?)
        `).run(patient_id, nurseId || null, doctor_id || req.session.doctorId || null, notes, findings);

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patient_id, `New checkup record added.`);

        res.json({ message: 'Checkup recorded successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
