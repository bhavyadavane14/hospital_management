const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const auth = require('../middleware/auth');

// Get all doctors
router.get('/', auth(), (req, res) => {
    const doctors = db.prepare('SELECT * FROM doctors').all();
    res.json(doctors);
});

// Get patients assigned to a specific doctor
router.get('/:id/patients', auth(['doctor', 'admin']), (req, res) => {
    const patients = db.prepare(`
        SELECT p.*, b.ward, b.bed_number 
        FROM patients p
        JOIN beds b ON p.bed_id = b.id
        WHERE p.doctor_id = ?
        ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END ASC, admission_time DESC
    `).all(req.params.id);
    res.json(patients);
});

// Add new doctor (Admin only)
router.post('/', auth(['admin']), (req, res) => {
    const { username, password, name, specialization } = req.body;
    const bcrypt = require('bcryptjs');
    
    const transaction = db.transaction(() => {
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);
        
        const userResult = db.prepare(`
            INSERT INTO users (username, password, role, name)
            VALUES (?, ?, 'doctor', ?)
        `).run(username, hashedPassword, name);
        
        const doctorId = db.prepare(`
            INSERT INTO doctors (user_id, name, specialization)
            VALUES (?, ?, ?)
        `).run(userResult.lastInsertRowid, name, specialization).lastInsertRowid;
        
        return doctorId;
    });

    try {
        const doctorId = transaction();
        res.json({ message: 'Doctor added successfully', doctorId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
