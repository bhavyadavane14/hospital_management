/**
 * MediMonitor Agent - Persistent State Manager
 *
 * Maintains the live in-memory state of an active agent run and synchronizes
 * snapshots to the SQLite backend (agent_runs, agent_states, agent_timeline, agent_tool_calls).
 */

const { db } = require('../models/database');

class AgentState {
    constructor(runId, caseId, patientId, goal, scenarioId = null) {
        this.run_id = runId;
        this.case_id = caseId;
        this.patient_id = patientId;
        this.goal = goal;
        this.scenario_id = scenarioId;

        this.current_state = 'INITIALIZED';
        this.status = 'running';
        this.observations = [];
        this.tools_used = [];
        this.findings = [];
        this.actions_taken = [];
        this.failed_actions = [];
        this.replan_count = 0;
        this.verification_status = 'pending';
        this.human_review_required = false;
        this.human_review_reason = null;
        this.human_review_evidence = [];
        this.final_outcome = null;
        this.step_index = 0;

        this.started_at = new Date().toISOString();
        this.completed_at = null;

        // Persist initial run record in database
        db.prepare(`
            INSERT INTO agent_runs (
                id, case_id, patient_id, goal, scenario_id, current_state, status,
                replan_count, verification_status, human_review_required, human_review_reason, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            this.run_id, this.case_id, this.patient_id, this.goal, this.scenario_id,
            this.current_state, this.status, this.replan_count, this.verification_status,
            0, null, this.started_at
        );

        this.persistSnapshot();
    }

    setState(stateName) {
        this.current_state = stateName;
        db.prepare(`UPDATE agent_runs SET current_state = ? WHERE id = ?`).run(stateName, this.run_id);
        this.persistSnapshot();
    }

    addObservation(text) {
        this.observations.push(text);
        this.persistSnapshot();
    }

    addFinding(finding) {
        this.findings.push(finding);
        this.persistSnapshot();
    }

    recordToolCall(toolCall) {
        this.tools_used.push({
            tool_name: toolCall.tool_name,
            success: toolCall.success,
            duration_ms: toolCall.duration_ms,
            timestamp: new Date().toISOString(),
            error_code: toolCall.error_code || null
        });

        db.prepare(`
            INSERT INTO agent_tool_calls (run_id, tool_name, input_payload, output_payload, success, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            this.run_id,
            toolCall.tool_name,
            JSON.stringify(toolCall.input_payload || {}),
            JSON.stringify(toolCall.output_payload || {}),
            toolCall.success ? 1 : 0,
            toolCall.duration_ms || 0
        );

        this.persistSnapshot();
    }

    recordAction(action) {
        this.actions_taken.push(action);
        this.persistSnapshot();
    }

    recordFailure(failure) {
        this.failed_actions.push(failure);
        this.persistSnapshot();
    }

    incrementReplan(reason = 'Alternative strategy required') {
        this.replan_count += 1;
        db.prepare(`UPDATE agent_runs SET replan_count = ? WHERE id = ?`).run(this.replan_count, this.run_id);
        this.addObservation(`Replanning triggered (Count: ${this.replan_count}): ${reason}`);
        this.persistSnapshot();
    }

    setVerificationStatus(status, details = null) {
        this.verification_status = status;
        db.prepare(`UPDATE agent_runs SET verification_status = ? WHERE id = ?`).run(status, this.run_id);
        this.persistSnapshot();
    }

    setHumanReviewRequired(reason, evidence = []) {
        this.human_review_required = true;
        this.human_review_reason = reason;
        this.human_review_evidence = evidence;
        this.status = 'human_review_required';
        this.current_state = 'HUMAN_REVIEW_REQUIRED';
        this.completed_at = new Date().toISOString();

        db.prepare(`
            UPDATE agent_runs 
            SET human_review_required = 1, human_review_reason = ?, status = ?, current_state = ?, completed_at = ?
            WHERE id = ?
        `).run(reason, this.status, this.current_state, this.completed_at, this.run_id);

        this.persistSnapshot();
    }

    completeRun(finalOutcome = 'Verified and completed') {
        this.final_outcome = finalOutcome;
        this.status = 'completed';
        this.current_state = 'COMPLETED';
        this.completed_at = new Date().toISOString();

        db.prepare(`
            UPDATE agent_runs 
            SET status = ?, current_state = ?, final_outcome = ?, completed_at = ?
            WHERE id = ?
        `).run(this.status, this.current_state, this.final_outcome, this.completed_at, this.run_id);

        this.persistSnapshot();
    }

    addTimelineStep(icon, title, description, badge = null) {
        this.step_index += 1;
        const step = {
            step_index: this.step_index,
            icon,
            title,
            description,
            badge,
            timestamp: new Date().toLocaleTimeString()
        };

        db.prepare(`
            INSERT INTO agent_timeline (run_id, step_index, icon, title, description, badge)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(this.run_id, step.step_index, icon, title, description, badge);

        return step;
    }

    persistSnapshot() {
        const stateSnapshot = this.toJSON();
        db.prepare(`
            INSERT INTO agent_states (run_id, state_json)
            VALUES (?, ?)
        `).run(this.run_id, JSON.stringify(stateSnapshot));
    }

    toJSON() {
        return {
            run_id: this.run_id,
            case_id: this.case_id,
            patient_id: this.patient_id,
            goal: this.goal,
            scenario_id: this.scenario_id,
            current_state: this.current_state,
            status: this.status,
            observations: [...this.observations],
            tools_used: [...this.tools_used],
            findings: [...this.findings],
            actions_taken: [...this.actions_taken],
            failed_actions: [...this.failed_actions],
            replan_count: this.replan_count,
            verification_status: this.verification_status,
            human_review_required: this.human_review_required,
            human_review_reason: this.human_review_reason,
            human_review_evidence: [...this.human_review_evidence],
            final_outcome: this.final_outcome,
            started_at: this.started_at,
            completed_at: this.completed_at
        };
    }
}

module.exports = AgentState;
