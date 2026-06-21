const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const classifier = require('../utils/chatbot_classifier');

// Helper to load training data from DB and train the classifier
function trainModelFromDb() {
    try {
        const rows = db.prepare('SELECT * FROM chatbot_training_data').all();
        classifier.train(rows);
        return { success: true, count: rows.length };
    } catch (err) {
        console.error('[Chatbot Route] Error loading training data:', err);
        return { success: false, error: err.message };
    }
}

// Public Endpoint: Process user query
router.post('/query', (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message field is required' });
    }

    try {
        const result = classifier.classify(message);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin/System Endpoint: Retrain the chatbot model manually
router.post('/train', (req, res) => {
    const result = trainModelFromDb();
    if (result.success) {
        res.json({ message: `Chatbot model retrained successfully! Loaded ${result.count} intents.` });
    } else {
        res.status(500).json({ error: result.error });
    }
});

// Public Endpoint: Get all FAQs (useful for onboarding/quick reply suggestions)
router.get('/faqs', (req, res) => {
    try {
        const faqs = db.prepare("SELECT intent, category, response, redirect_url, training_phrases FROM chatbot_training_data WHERE category = 'faq'").all();
        res.json(faqs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin/Staff Endpoint: Add or update a training FAQ/intent
router.post('/faqs', (req, res) => {
    const { intent, category, response, redirect_url, training_phrases } = req.body;

    if (!intent || !category || !response || !training_phrases) {
        return res.status(400).json({ error: 'Missing required fields (intent, category, response, training_phrases)' });
    }

    try {
        db.prepare(`
            INSERT OR REPLACE INTO chatbot_training_data 
            (intent, category, response, redirect_url, training_phrases) 
            VALUES (?, ?, ?, ?, ?)
        `).run(intent, category, response, redirect_url || null, training_phrases);

        // Retrain immediately after database modification
        const trainResult = trainModelFromDb();
        
        res.json({ 
            message: 'Intent saved successfully. Model retrained!',
            intent,
            modelRetrained: trainResult.success
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Export training helper so server.js can run it on startup
module.exports = {
    router,
    trainModelFromDb
};
