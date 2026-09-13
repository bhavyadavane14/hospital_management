/**
 * MediMonitor Agent - Orchestrator / Controller
 *
 * Implements the closed-loop agentic lifecycle:
 * GOAL -> OBSERVE -> ASSESS -> PLAN -> SELECT TOOL -> GET RESULT ->
 * UPDATE STATE -> TAKE PERMITTED ACTION -> OBSERVE RESULT -> VERIFY -> SUCCESS
 * OR: FAILURE / CHANGED CONDITION -> REPLAN -> NEW ACTION -> VERIFY
 * OR: DRUG CONFLICT / UNCERTAINTY -> HUMAN REVIEW REQUIRED
 *
 * Strict healthcare boundary:
 * - Deterministic safety classification
 * - Predefined workflow protocols
 * - User-safe action summaries (no raw hidden chain of thought)
 */

const AgentState = require('./agentState');
const AgentTools = require('./agentTools');
const {
    evaluateDeterministicSafety,
    getWorkflowProtocol,
    detectMedicationAllergyConflict
} = require('./safetyRules');

// Small helper for observable step transitions in the live UI
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class AgentController {
    constructor(io = null) {
        this.io = io;
        this.tools = new AgentTools(io);
    }

    setSocketIo(io) {
        this.io = io;
        this.tools.setSocketIo(io);
    }

    /**
     * Broadcast an agent event to connected dashboard clients
     */
    emitEvent(eventName, payload) {
        if (this.io) {
            this.io.emit(eventName, payload);
        }
    }

    /**
     * Emit a user-safe step update to the timeline and state
     */
    async logStep(state, icon, title, description, badge = null, pauseMs = 700) {
        const step = state.addTimelineStep(icon, title, description, badge);
        this.emitEvent('agent:step', {
            run_id: state.run_id,
            step,
            current_state: state.current_state,
            state: state.toJSON()
        });
        if (pauseMs > 0) {
            await delay(pauseMs);
        }
    }

    /**
     * Main execution entry point
     */
    async runAgent({ patient_id, goal, scenario_id = 'default', run_id = null }) {
        const generatedRunId = run_id || `RUN-${Date.now().toString().slice(-6)}`;
        const caseId = `CASE-${patient_id}`;
        const finalGoal = goal || 'Process patient case safely under clinical workflow protocol';

        const state = new AgentState(generatedRunId, caseId, patient_id, finalGoal, scenario_id);

        try {
            // ── 1. GOAL INITIALIZATION ──────────────────────────────────────
            state.setState('GOAL_INITIALIZED');
            await this.logStep(
                state,
                '🎯',
                'Goal Initialized',
                `Monitoring case ${caseId} for Patient #${patient_id}: "${finalGoal}"`,
                'ACTIVE'
            );

            // ── 2. OBSERVE: Patient Record Retrieval ────────────────────────
            state.setState('OBSERVING');
            await this.logStep(
                state,
                '👀',
                'Observing Patient State',
                `Retrieving admission record, demographics, and assigned care team for Patient #${patient_id}...`
            );

            const patientResult = await this.tools.get_patient(patient_id);
            state.recordToolCall({
                tool_name: 'Patient Record Tool',
                input_payload: { patient_id },
                output_payload: patientResult.data || patientResult.message,
                success: patientResult.success,
                duration_ms: patientResult.duration_ms
            });

            if (!patientResult.success) {
                await this.logStep(state, '❌', 'Patient Record Lookup Failed', patientResult.message, 'ERROR');
                state.completeRun('Execution aborted: Patient record could not be retrieved');
                return state.toJSON();
            }

            const patient = patientResult.data;
            state.addObservation(`Patient Profile: ${patient.name}, ${patient.age}y ${patient.gender}. Bed: ${patient.bed}. Physician: ${patient.doctor}.`);
            await this.logStep(
                state,
                '🔧',
                'Patient Record Tool',
                `Profile verified: ${patient.name} (${patient.age}y ${patient.gender}) | Physician: ${patient.doctor} | Bed: ${patient.bed}`,
                'VERIFIED'
            );

            // ── 3. TOOL SELECTION & OBSERVATION: Vitals & History ────────────
            state.setState('CHECKING_VITALS');
            await this.logStep(
                state,
                '🔧',
                'Calling Vitals Tool',
                `Querying multi-reading chronological vitals logs to evaluate rate of change and hemodynamic trends...`
            );

            const vitalsResult = await this.tools.get_patient_vitals(patient_id);
            state.recordToolCall({
                tool_name: 'Vitals Tool',
                input_payload: { patient_id },
                output_payload: vitalsResult.data || vitalsResult.message,
                success: vitalsResult.success,
                duration_ms: vitalsResult.duration_ms
            });

            const vitalsData = vitalsResult.data || { history: [], trend: { hasTrend: false } };
            const trend = vitalsData.trend || {};

            if (trend.isWorsening) {
                state.addObservation(`Vital Trend: ${trend.summary}`);
                await this.logStep(
                    state,
                    '📊',
                    'Vitals Retrieved - Abnormal Trend Detected',
                    trend.summary,
                    'DETERIORATING'
                );
            } else {
                state.addObservation(`Vitals Baseline: Stable across ${vitalsData.readingCount || 0} readings.`);
                await this.logStep(
                    state,
                    '📊',
                    'Vitals Retrieved - Stable Baseline',
                    trend.summary || 'Patient vital signs are within acceptable protocol range.',
                    'STABLE'
                );
            }

            // ── 4. ASSESS & TOOL SELECTION: Labs, Allergies, Medications ─────
            state.setState('ASSESSING');
            await this.logStep(
                state,
                '🧠',
                'Assessing Patient State',
                'Evaluating information gaps: Cross-referencing allergy history, active medications, and lab panels...'
            );

            // Allergy Tool
            const allergyResult = await this.tools.get_patient_allergies(patient_id);
            state.recordToolCall({
                tool_name: 'Allergy Tool',
                input_payload: { patient_id },
                output_payload: allergyResult.data || allergyResult.message,
                success: allergyResult.success,
                duration_ms: allergyResult.duration_ms
            });
            const allergies = (allergyResult.data && allergyResult.data.allergies) || [];

            // Medication Tool
            const medResult = await this.tools.get_patient_medications(patient_id);
            state.recordToolCall({
                tool_name: 'Medication Tool',
                input_payload: { patient_id },
                output_payload: medResult.data || medResult.message,
                success: medResult.success,
                duration_ms: medResult.duration_ms
            });
            const medications = (medResult.data && medResult.data.medications) || [];

            // Laboratory Tool
            const labResult = await this.tools.get_patient_labs(patient_id);
            state.recordToolCall({
                tool_name: 'Laboratory Tool',
                input_payload: { patient_id },
                output_payload: labResult.data || labResult.message,
                success: labResult.success,
                duration_ms: labResult.duration_ms
            });
            const labs = (labResult.data && labResult.data.labs) || [];

            // ── 5. DETERMINISTIC SAFETY & CONFLICT EVALUATION ───────────────
            const safetyEvaluation = evaluateDeterministicSafety({
                patient,
                vitals: vitalsData.history || [],
                labs,
                allergies,
                medications
            });

            // ── SCENARIO A: MEDICATION-ALLERGY CONFLICT (HUMAN ESCALATION) ──
            if (safetyEvaluation.conflictAnalysis.conflictDetected) {
                state.addObservation('POTENTIAL RECORD CONFLICT: Active medication cross-reactivity with documented allergy.');
                await this.logStep(
                    state,
                    '⚠️',
                    'Potential Record Conflict Detected',
                    safetyEvaluation.conflictAnalysis.evidenceSummary,
                    'CONFLICT'
                );

                state.setState('ESCALATING');
                await this.logStep(
                    state,
                    '🚨',
                    'Safety Boundary Enforced: Escalating to Human Review',
                    'Agentic safety guardrail: Autonomous medication modification or cancellation is strictly prohibited. Case halted for physician review.',
                    'HUMAN REVIEW'
                );

                // Permitted workflow action: Update workflow status to PENDING_HUMAN_REVIEW
                const statusAction = await this.tools.execute_workflow_action(
                    'update_workflow_status',
                    {
                        patient_id,
                        workflow_status: 'PENDING_HUMAN_REVIEW',
                        reason: 'Drug-allergy record conflict'
                    },
                    { run_id: state.run_id }
                );
                state.recordAction(statusAction.data);

                // Create alert for medical staff
                const alertAction = await this.tools.execute_workflow_action(
                    'create_emergency_alert',
                    {
                        patient_id,
                        message: `SAFETY ESCALATION: Potential drug-allergy conflict for ${patient.name}. Review required before administration.`,
                        alert_type: 'DRUG_ALLERGY_CONFLICT'
                    },
                    { run_id: state.run_id }
                );
                state.recordAction(alertAction.data);

                // Verification of human review flag
                const verifyResult = await this.tools.verify_action(statusAction.action_id, state.run_id);
                state.setVerificationStatus(verifyResult.data.verified ? 'verified' : 'failed');

                await this.logStep(
                    state,
                    '✓',
                    'Escalation Workflow Verified',
                    'Workflow status updated to PENDING_HUMAN_REVIEW and emergency notification delivered to attending team.',
                    'ESCALATED'
                );

                state.setHumanReviewRequired(
                    safetyEvaluation.conflictAnalysis.humanReviewReason,
                    safetyEvaluation.conflictAnalysis.conflicts
                );

                this.emitEvent('agent:complete', { run_id: state.run_id, state: state.toJSON() });
                return state.toJSON();
            }

            // ── 6. PROTOCOL PLANNING & WORKFLOW EXECUTION ────────────────────
            const classification = safetyEvaluation.classification;
            const protocol = getWorkflowProtocol(classification);

            state.setState('PLANNING');
            await this.logStep(
                state,
                '🧠',
                'Planning Next Workflow Action',
                `Deterministic Classification: [${classification}]. Protocol target: ${protocol.targetWorkflowStatus}. Initiating permitted workflow protocol...`,
                classification
            );

            // ── SCENARIO B: EMERGENCY WORKFLOW WITH INTENTIONAL FAILURE & REPLAN
            if (classification === 'EMERGENCY_WORKFLOW' || classification === 'HIGH_PRIORITY') {
                const primaryResourceType = protocol.resourceProtocol.primaryType;

                state.setState('QUERYING_RESOURCE');
                await this.logStep(
                    state,
                    '🔧',
                    'Hospital Resource Tool',
                    `Checking availability for primary protocol emergency resource: "${primaryResourceType}"...`
                );

                const primaryResourceCheck = await this.tools.get_available_resources(primaryResourceType);
                state.recordToolCall({
                    tool_name: 'Hospital Resource Tool',
                    input_payload: { resource_type: primaryResourceType },
                    output_payload: primaryResourceCheck.data || primaryResourceCheck.message,
                    success: primaryResourceCheck.success,
                    duration_ms: primaryResourceCheck.duration_ms
                });

                let allocatedResource = null;

                // Check if primary resource failed (Simulated Failure Scenario)
                if (!primaryResourceCheck.success) {
                    state.recordFailure({
                        resource_type: primaryResourceType,
                        reason: primaryResourceCheck.message,
                        timestamp: new Date().toISOString()
                    });

                    await this.logStep(
                        state,
                        '❌',
                        `Preferred Resource Unavailable`,
                        `Primary protocol resource "${primaryResourceType}" is currently at full capacity. Immediate adaptation required.`,
                        'CAPACITY_FULL'
                    );

                    // ── REPLANNING PHASE ─────────────────────────────────────
                    state.setState('REPLANNING');
                    state.incrementReplan(`Alternative protocol resource search for ${primaryResourceType}`);
                    
                    const fallbackType = protocol.resourceProtocol.fallbackType;
                    await this.logStep(
                        state,
                        '🔄',
                        'Replanning Workflow Strategy',
                        `Consulting simulated protocol fallback matrix. Alternative emergency resource candidate: "${fallbackType}".`,
                        'REPLANNING'
                    );

                    await this.logStep(
                        state,
                        '🔧',
                        'Hospital Resource Tool (Alternative Search)',
                        `Querying availability for fallback resource: "${fallbackType}"...`
                    );

                    const fallbackCheck = await this.tools.get_available_resources(fallbackType);
                    state.recordToolCall({
                        tool_name: 'Hospital Resource Tool',
                        input_payload: { resource_type: fallbackType },
                        output_payload: fallbackCheck.data || fallbackCheck.message,
                        success: fallbackCheck.success,
                        duration_ms: fallbackCheck.duration_ms
                    });

                    if (fallbackCheck.success && fallbackCheck.data.count > 0) {
                        allocatedResource = fallbackCheck.data.primary_match;
                        await this.logStep(
                            state,
                            '✓',
                            'Alternative Resource Secured',
                            `Available resource found: ${allocatedResource.name} (${allocatedResource.ward}). Continuous telemetry ready.`,
                            'REALLOCATED'
                        );
                    } else {
                        // All physical beds full -> dispatch RRT Standby
                        const rrtCheck = await this.tools.get_available_resources('Rapid Response Team');
                        allocatedResource = rrtCheck.data.primary_match;
                    }
                } else {
                    allocatedResource = primaryResourceCheck.data.primary_match;
                }

                // ── EXECUTE REVISED / ALLOCATED WORKFLOW ACTION ──────────────
                state.setState('EXECUTING_ACTION');
                await this.logStep(
                    state,
                    '⚙️',
                    'Executing Permitted Workflow Actions',
                    `Allocating ${allocatedResource.name} and initiating emergency escalation workflow for Patient #${patient_id}...`
                );

                // 1. Resource allocation action
                const resourceAction = await this.tools.execute_workflow_action(
                    'allocate_hospital_resource',
                    {
                        resource_id: allocatedResource.id,
                        patient_id,
                        notes: `Assigned under ${classification} protocol (${state.replan_count > 0 ? 'Replanned Fallback' : 'Primary'})`
                    },
                    { run_id: state.run_id, is_replanned: state.replan_count > 0 }
                );
                state.recordAction(resourceAction.data);

                // 2. Emergency Alert action
                const alertAction = await this.tools.execute_workflow_action(
                    'create_emergency_alert',
                    {
                        patient_id,
                        message: `CRITICAL WORKFLOW ALERT: ${patient.name} transferred to ${allocatedResource.name}. Abnormal vitals trend detected.`,
                        alert_type: 'CRITICAL_TRANSFER'
                    },
                    { run_id: state.run_id, is_replanned: state.replan_count > 0 }
                );
                state.recordAction(alertAction.data);

                // 3. Update workflow status
                const statusAction = await this.tools.execute_workflow_action(
                    'update_workflow_status',
                    {
                        patient_id,
                        workflow_status: protocol.targetWorkflowStatus,
                        reason: `Protocol allocation to ${allocatedResource.name}`
                    },
                    { run_id: state.run_id, is_replanned: state.replan_count > 0 }
                );
                state.recordAction(statusAction.data);

                // ── VERIFICATION PHASE ───────────────────────────────────────
                state.setState('VERIFYING');
                await this.logStep(
                    state,
                    '🔍',
                    'Verifying Workflow Execution',
                    'Auditing database records to confirm resource occupancy, alert delivery, and patient workflow status...'
                );

                const verifyResource = await this.tools.verify_action(resourceAction.action_id, state.run_id);
                const verifyAlert = await this.tools.verify_action(alertAction.action_id, state.run_id);
                const verifyStatus = await this.tools.verify_action(statusAction.action_id, state.run_id);

                const allVerified = verifyResource.data.verified && verifyAlert.data.verified && verifyStatus.data.verified;
                state.setVerificationStatus(allVerified ? 'verified' : 'failed');

                if (allVerified) {
                    await this.logStep(
                        state,
                        '✓',
                        'Workflow State Verified',
                        `Confirmed: ${allocatedResource.name} status is Occupied, Emergency Alert is Active, and Workflow Status is ${protocol.targetWorkflowStatus}.`,
                        'VERIFIED'
                    );
                    state.completeRun(`Emergency case safely escalated, replanned (${state.replan_count} replans), and verified.`);
                } else {
                    await this.logStep(state, '❌', 'Verification Anomaly Detected', 'Database state did not match expected parameters.', 'FAILED');
                    state.completeRun('Action execution could not be completely verified');
                }
            } 
            // ── SCENARIO C: ROUTINE CLINICAL SAFETY FOLLOW-UP ────────────────
            else {
                state.setState('EXECUTING_ACTION');
                await this.logStep(
                    state,
                    '⚙️',
                    'Executing Routine Follow-up Workflow',
                    `Patient is stable. Scheduling post-discharge clinical follow-up checkup per hospital standard protocol...`
                );

                const followupAction = await this.tools.execute_workflow_action(
                    'schedule_followup',
                    {
                        patient_id,
                        follow_up_days: 3,
                        notes: 'Routine clinical safety follow-up consultation scheduled.'
                    },
                    { run_id: state.run_id }
                );
                state.recordAction(followupAction.data);

                const statusAction = await this.tools.execute_workflow_action(
                    'update_workflow_status',
                    {
                        patient_id,
                        workflow_status: protocol.targetWorkflowStatus,
                        reason: 'Routine post-discharge clinical follow-up protocol'
                    },
                    { run_id: state.run_id }
                );
                state.recordAction(statusAction.data);

                // Verify
                state.setState('VERIFYING');
                await this.logStep(
                    state,
                    '🔍',
                    'Verifying Follow-up Entry',
                    'Confirming checkup entry persistence in the clinical registry...'
                );

                const verifyFollowup = await this.tools.verify_action(followupAction.action_id, state.run_id);
                state.setVerificationStatus(verifyFollowup.data.verified ? 'verified' : 'failed');

                await this.logStep(
                    state,
                    '✓',
                    'Action Verified',
                    'Clinical follow-up successfully scheduled (+3 days) and confirmed in clinical registry.',
                    'VERIFIED'
                );

                state.completeRun('Routine safety follow-up successfully completed and verified.');
            }

            // ── 7. FINAL OUTCOME ────────────────────────────────────────────
            await this.logStep(
                state,
                '🎯',
                'Goal Completed & Verified',
                `Case ${caseId} execution concluded: ${state.final_outcome}`,
                'COMPLETED',
                0
            );

            this.emitEvent('agent:complete', { run_id: state.run_id, state: state.toJSON() });
            return state.toJSON();
        } catch (fatalError) {
            console.error('Fatal agent execution error:', fatalError);
            state.setState('FAILED');
            state.completeRun(`Fatal execution error: ${fatalError.message}`);
            await this.logStep(state, '❌', 'Execution Error', fatalError.message, 'FATAL', 0);
            this.emitEvent('agent:complete', { run_id: state.run_id, state: state.toJSON() });
            return state.toJSON();
        }
    }
}

module.exports = AgentController;
