const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get bed statistics (OS: Resource Monitoring)
router.get('/stats', auth(), (req, res) => {
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) as available,
            SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) as occupied,
            SUM(CASE WHEN status = 'ICU' THEN 1 ELSE 0 END) as icu
        FROM beds
    `).get();
    res.json(stats);
});

// Get all beds
router.get('/', auth(), (req, res) => {
    const beds = db.prepare('SELECT * FROM beds').all();
    res.json(beds);
});

// Allocate Bed and Doctor to Patient (Admin only)
router.post('/allocate', auth(['admin']), (req, res) => {
    const { patient_id, bed_id, doctor_id } = req.body;
    
    const transaction = db.transaction(() => {
        // Free up old bed if any
        const oldPatient = db.prepare('SELECT bed_id FROM patients WHERE id = ?').get(patient_id);
        if (oldPatient && oldPatient.bed_id) {
            db.prepare(`UPDATE beds SET status = 'Available' WHERE id = ?`).run(oldPatient.bed_id);
        }

        // Occupy new bed
        db.prepare(`UPDATE beds SET status = 'Occupied' WHERE id = ?`).run(bed_id);
        
        // Update patient
        db.prepare(`
            UPDATE patients 
            SET bed_id = ?, doctor_id = ?, status = 'Active' 
            WHERE id = ?
        `).run(bed_id, doctor_id, patient_id);

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(patient_id, `Admin allocated Bed (ID: ${bed_id}) and Doctor (ID: ${doctor_id})`);
    });

    try {
        transaction();
        res.json({ message: 'Patient allocated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
