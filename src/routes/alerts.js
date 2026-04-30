const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get active alerts for a doctor
router.get('/active/:doctor_id', auth(['doctor', 'admin']), (req, res) => {
    const alerts = db.prepare(`
        SELECT a.*, p.name as patient_name 
        FROM alerts a
        JOIN patients p ON a.patient_id = p.id
        WHERE a.doctor_id = ? AND a.status = 'Active'
        ORDER BY timestamp DESC
    `).all(req.params.doctor_id);
    res.json(alerts);
});

// Dismiss alert
router.post('/:id/dismiss', auth(['doctor']), (req, res) => {
    try {
        db.prepare('UPDATE alerts SET status = ? WHERE id = ?').run('Dismissed', req.params.id);
        res.json({ message: 'Alert dismissed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
