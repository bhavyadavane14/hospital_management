const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../models/database');
const auth = require('../middleware/auth');

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        let doctorId = null;
        let nurseId = null;
        if (user.role === 'doctor') {
            const dr = db.prepare('SELECT id FROM doctors WHERE user_id = ?').get(user.id);
            doctorId = dr ? dr.id : null;
        } else if (user.role === 'nurse') {
            const nr = db.prepare('SELECT id FROM nurses WHERE user_id = ?').get(user.id);
            nurseId = nr ? nr.id : null;
        }

        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.name = user.name;
        req.session.doctorId = doctorId;
        req.session.nurseId = nurseId;
        
        res.json({ 
            message: 'Login successful', 
            user: { id: user.id, doctorId, nurseId, username: user.username, role: user.role, name: user.name } 
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

router.get('/me', (req, res) => {
    if (req.session.userId) {
        res.json({ 
            user: { 
                id: req.session.userId, 
                doctorId: req.session.doctorId, 
                nurseId: req.session.nurseId,
                role: req.session.role, 
                name: req.session.name 
            } 
        });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Admin: Create Staff User (Nurse/Doctor)
router.post('/admin/create-user', auth(['admin']), async (req, res) => {
    const { username, password, role, name, specialization } = req.body;
    
    try {
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);
        
        const transaction = db.transaction(() => {
            const user = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?) RETURNING id').get(username, hashedPassword, role, name);
            
            if (role === 'doctor') {
                db.prepare('INSERT INTO doctors (user_id, name, specialization) VALUES (?, ?, ?)').run(user.id, name, specialization);
            } else if (role === 'nurse') {
                db.prepare('INSERT INTO nurses (user_id, name) VALUES (?, ?)').run(user.id, name);
            }
            
            return user.id;
        });

        const userId = transaction();
        res.json({ message: 'User created successfully', userId });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
