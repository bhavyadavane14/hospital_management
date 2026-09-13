/**
 * MediMonitor Agent - API Router
 *
 * Exposes endpoints for initiating runs, querying execution histories,
 * inspecting tool calls & verifications, acknowledging human escalations,
 * and querying sub-resources.
 */

const express = require('express');
const router = express.Router();
const { db } = require('../models/database');
const AgentController = require('../agent/agentController');
const auth = require('../middleware/auth');

// Enforce staff authentication on all Agent API routes
router.use(auth(['admin', 'doctor', 'nurse']));

let agentControllerInstance = null;

function getController(io) {
    if (!agentControllerInstance) {
        agentControllerInstance = new AgentController(io);
    } else if (io) {
        agentControllerInstance.setSocketIo(io);
    }
    return agentControllerInstance;
}

// ── 1. LAUNCH AGENT RUN ──────────────────────────────────────────────────
router.post('/run', async (req, res) => {
    const { patient_id, goal, scenario_id } = req.body;
    const targetPatientId = parseInt(patient_id, 10);

    if (!targetPatientId) {
        return res.status(400).json({ error: 'Valid patient_id is required' });
    }

    const io = req.app.get('io');
    const controller = getController(io);

    const runId = `RUN-${Date.now().toString().slice(-6)}`;

    // Return immediate response with runId and running status
    res.json({
        run_id: runId,
        status: 'running',
        patient_id: targetPatientId,
        goal: goal || 'Process patient case safely under clinical workflow protocol',
        message: 'MediMonitor Agent run initialized.'
    });

    // Run the closed-loop agent asynchronously in the background
    // Live progress will stream over Socket.io
    setImmediate(async () => {
        try {
            await controller.runAgent({
                patient_id: targetPatientId,
                goal,
                scenario_id,
                run_id: runId
            });
        } catch (err) {
            console.error('Agent execution error in background run:', err);
        }
    });
});

// ── 2. GET RECENT AGENT RUNS ──────────────────────────────────────────────
router.get('/runs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const patientId = req.query.patient_id;

        let query = `
            SELECT r.*, p.name as patient_name, p.age, p.gender
            FROM agent_runs r
            JOIN patients p ON r.patient_id = p.id
        `;
        const params = [];

        if (patientId) {
            query += ` WHERE r.patient_id = ?`;
            params.push(patientId);
        }

        query += ` ORDER BY r.started_at DESC LIMIT ?`;
        params.push(limit);

        const runs = db.prepare(query).all(...params);
        res.json(runs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── 3. GET SPECIFIC AGENT RUN DETAILS ─────────────────────────────────────
router.get('/runs/:runId', (req, res) => {
    try {
        const runId = req.params.runId;
        const run = db.prepare(`
            SELECT r.*, p.name as patient_name, p.age, p.gender
            FROM agent_runs r
            JOIN patients p ON r.patient_id = p.id
            WHERE r.id = ?
        `).get(runId);

        if (!run) {
            return res.status(404).json({ error: `Run ${runId} not found` });
        }

        const timeline = db.prepare(`
            SELECT * FROM agent_timeline 
            WHERE run_id = ? 
            ORDER BY step_index ASC
        `).all(runId);

        const toolCalls = db.prepare(`
            SELECT * FROM agent_tool_calls 
            WHERE run_id = ? 
            ORDER BY id ASC
        `).all(runId).map(t => ({
            ...t,
            input_payload: JSON.parse(t.input_payload || '{}'),
            output_payload: JSON.parse(t.output_payload || '{}')
        }));

        const actions = db.prepare(`
            SELECT * FROM agent_actions 
            WHERE run_id = ? 
            ORDER BY id ASC
        `).all(runId).map(a => ({
            ...a,
            action_payload: JSON.parse(a.action_payload || '{}')
        }));

        const verifications = db.prepare(`
            SELECT * FROM agent_verifications 
            WHERE run_id = ? 
            ORDER BY id ASC
        `).all(runId).map(v => ({
            ...v,
            details: JSON.parse(v.details || '{}')
        }));

        const latestState = db.prepare(`
            SELECT state_json FROM agent_states 
            WHERE run_id = ? 
            ORDER BY id DESC LIMIT 1
        `).get(runId);

        res.json({
            run,
            timeline,
            toolCalls,
            actions,
            verifications,
            state: latestState ? JSON.parse(latestState.state_json) : null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── 4. GET RUNS BY CASE ID ────────────────────────────────────────────────
router.get('/cases/:caseId', (req, res) => {
    try {
        const caseId = req.params.caseId;
        const runs = db.prepare(`
            SELECT r.*, p.name as patient_name 
            FROM agent_runs r
            JOIN patients p ON r.patient_id = p.id
            WHERE r.case_id = ? 
            ORDER BY r.started_at DESC
        `).all(caseId);

        res.json(runs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── 5. ACKNOWLEDGE HUMAN REVIEW ESCALATION ─────────────────────────────────
router.post('/acknowledge/:runId', (req, res) => {
    try {
        const runId = req.params.runId;
        const { reviewer_notes, signed_by } = req.body;

        const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId);
        if (!run) {
            return res.status(404).json({ error: `Run ${runId} not found` });
        }

        const reviewerText = `Acknowledged by ${signed_by || 'Attending Physician'}: ${reviewer_notes || 'Clinical conflict reviewed and signed off.'}`;

        db.prepare(`
            UPDATE agent_runs 
            SET status = 'acknowledged', reviewer_notes = ? 
            WHERE id = ?
        `).run(reviewerText, runId);

        db.prepare(`
            UPDATE patients 
            SET workflow_status = 'MONITORING' 
            WHERE id = ?
        `).run(run.patient_id);

        db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(
            run.patient_id,
            `HUMAN REVIEW SIGNED-OFF: ${reviewerText}`
        );

        const io = req.app.get('io');
        if (io) {
            io.emit('agent:acknowledged', { run_id: runId, reviewer_notes: reviewerText });
        }

        res.json({
            message: 'Human review escalation acknowledged and recorded.',
            run_id: runId,
            status: 'acknowledged'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── 6. VERIFY AN ACTION EXTERNALLY ─────────────────────────────────────────
router.post('/verify/:actionId', async (req, res) => {
    try {
        const actionId = parseInt(req.params.actionId, 10);
        const io = req.app.get('io');
        const controller = getController(io);
        const result = await controller.tools.verify_action(actionId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── 7. HOSPITAL RESOURCES INVENTORY ────────────────────────────────────────
router.get('/resources', (req, res) => {
    try {
        const { resource_type, status } = req.query;
        let query = `SELECT * FROM hospital_resources WHERE 1=1`;
        const params = [];

        if (resource_type) {
            query += ` AND resource_type = ?`;
            params.push(resource_type);
        }
        if (status) {
            query += ` AND status = ?`;
            params.push(status);
        }

        const resources = db.prepare(query).all(...params);
        res.json(resources);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
