/**
 * MediMonitor Agent - Controlled Tool Layer
 *
 * Provides controlled, auditable tool interfaces for the Agent Orchestrator.
 * Every tool returns structured { success, data, error_code, message }.
 * Strict safety: LLM has NO direct unrestricted SQL access.
 */

const { db } = require('../models/database');
const { evaluateVitalsTrend, detectMedicationAllergyConflict } = require('./safetyRules');

class AgentTools {
    constructor(io = null) {
        this.io = io;
    }

    setSocketIo(io) {
        this.io = io;
    }

    /**
     * 1. Patient Record Tool: Retrieve patient profile and relevant history
     */
    async get_patient(patient_id) {
        const start = Date.now();
        try {
            const patient = db.prepare(`
                SELECT p.*, b.ward, b.bed_number, d.name as doctor_name, d.specialization as doctor_specialization, n.name as nurse_name
                FROM patients p
                LEFT JOIN beds b ON p.bed_id = b.id
                LEFT JOIN doctors d ON p.doctor_id = d.id
                LEFT JOIN nurses n ON p.nurse_id = n.id
                WHERE p.id = ?
            `).get(patient_id);

            if (!patient) {
                return {
                    success: false,
                    tool_name: 'Patient Record Tool',
                    duration_ms: Date.now() - start,
                    error_code: 'PATIENT_NOT_FOUND',
                    message: `Patient ID ${patient_id} does not exist in the hospital registry.`
                };
            }

            return {
                success: true,
                tool_name: 'Patient Record Tool',
                duration_ms: Date.now() - start,
                data: {
                    id: patient.id,
                    name: patient.name,
                    age: patient.age,
                    gender: patient.gender,
                    admission_time: patient.admission_time,
                    severity: patient.severity,
                    status: patient.status,
                    workflow_status: patient.workflow_status || 'MONITORING',
                    doctor: patient.doctor_name ? `${patient.doctor_name} (${patient.doctor_specialization || 'General'})` : 'Unassigned',
                    nurse: patient.nurse_name || 'Unassigned',
                    bed: patient.bed_number ? `${patient.ward} - ${patient.bed_number}` : 'Unallocated'
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Patient Record Tool',
                duration_ms: Date.now() - start,
                error_code: 'QUERY_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 2. Vitals Tool: Retrieve current and historical vital readings + trend analysis
     */
    async get_patient_vitals(patient_id) {
        const start = Date.now();
        try {
            const vitals = db.prepare(`
                SELECT * FROM vitals_logs 
                WHERE patient_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 10
            `).all(patient_id);

            if (!vitals || vitals.length === 0) {
                return {
                    success: true,
                    tool_name: 'Vitals Tool',
                    duration_ms: Date.now() - start,
                    data: {
                        history: [],
                        trend: { hasTrend: false, summary: 'No historical readings' }
                    }
                };
            }

            const trend = evaluateVitalsTrend(vitals);

            return {
                success: true,
                tool_name: 'Vitals Tool',
                duration_ms: Date.now() - start,
                data: {
                    latest: vitals[0],
                    readingCount: vitals.length,
                    history: vitals,
                    trend: trend
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Vitals Tool',
                duration_ms: Date.now() - start,
                error_code: 'VITALS_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 3. Medication Tool: Retrieve current and past medication records
     */
    async get_patient_medications(patient_id) {
        const start = Date.now();
        try {
            const medications = db.prepare(`
                SELECT * FROM medications 
                WHERE patient_id = ? 
                ORDER BY start_date DESC
            `).all(patient_id);

            return {
                success: true,
                tool_name: 'Medication Tool',
                duration_ms: Date.now() - start,
                data: {
                    count: medications.length,
                    medications
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Medication Tool',
                duration_ms: Date.now() - start,
                error_code: 'MEDICATION_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 4. Allergy Tool: Retrieve documented patient allergies
     */
    async get_patient_allergies(patient_id) {
        const start = Date.now();
        try {
            const allergies = db.prepare(`
                SELECT * FROM allergies 
                WHERE patient_id = ? 
                ORDER BY recorded_at DESC
            `).all(patient_id);

            return {
                success: true,
                tool_name: 'Allergy Tool',
                duration_ms: Date.now() - start,
                data: {
                    count: allergies.length,
                    allergies
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Allergy Tool',
                duration_ms: Date.now() - start,
                error_code: 'ALLERGY_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 5. Laboratory Tool: Retrieve relevant laboratory test results
     */
    async get_patient_labs(patient_id) {
        const start = Date.now();
        try {
            const labs = db.prepare(`
                SELECT * FROM lab_results 
                WHERE patient_id = ? 
                ORDER BY collected_at DESC
            `).all(patient_id);

            const abnormalCount = labs.filter(l => l.flag !== 'NORMAL').length;

            return {
                success: true,
                tool_name: 'Laboratory Tool',
                duration_ms: Date.now() - start,
                data: {
                    totalTests: labs.length,
                    abnormalCount,
                    labs
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Laboratory Tool',
                duration_ms: Date.now() - start,
                error_code: 'LAB_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 6. Hospital Resource Tool: Check resource availability with intentional simulation
     * Follows predefined workflow rules; returns structured failure if preferred resource is unavailable.
     */
    async get_available_resources(resource_type, options = {}) {
        const start = Date.now();
        try {
            let query = `SELECT * FROM hospital_resources WHERE resource_type = ?`;
            const params = [resource_type];

            if (options.ward) {
                query += ` AND ward = ?`;
                params.push(options.ward);
            }

            const allMatching = db.prepare(query).all(...params);
            const available = allMatching.filter(r => r.status === 'Available');

            if (available.length === 0) {
                // Return structured RESOURCE_UNAVAILABLE error
                const alternativeTypes = db.prepare(`
                    SELECT DISTINCT resource_type, COUNT(*) as avail_count 
                    FROM hospital_resources 
                    WHERE status = 'Available' AND resource_type != ?
                    GROUP BY resource_type
                `).all(resource_type);

                return {
                    success: false,
                    tool_name: 'Hospital Resource Tool',
                    duration_ms: Date.now() - start,
                    error_code: 'RESOURCE_UNAVAILABLE',
                    message: `Preferred hospital resource "${resource_type}" is currently at maximum occupancy or unavailable.`,
                    requested_type: resource_type,
                    available_alternatives: alternativeTypes
                };
            }

            return {
                success: true,
                tool_name: 'Hospital Resource Tool',
                duration_ms: Date.now() - start,
                data: {
                    resource_type,
                    count: available.length,
                    primary_match: available[0],
                    all_available: available
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Hospital Resource Tool',
                duration_ms: Date.now() - start,
                error_code: 'RESOURCE_ERROR',
                message: error.message
            };
        }
    }

    /**
     * 7. Workflow Action Tool: Execute permitted hospital workflow actions
     * Actions: update_workflow_status, create_emergency_alert, allocate_hospital_resource, schedule_followup
     */
    async execute_workflow_action(action_type, payload = {}, context = {}) {
        const start = Date.now();
        const run_id = context.run_id || 'STANDALONE';
        const is_replanned = context.is_replanned ? 1 : 0;

        try {
            let actionResult = null;

            if (action_type === 'update_workflow_status') {
                const { patient_id, workflow_status, reason } = payload;
                db.prepare(`UPDATE patients SET workflow_status = ? WHERE id = ?`).run(workflow_status, patient_id);
                db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(
                    patient_id,
                    `Workflow Status updated to: ${workflow_status} (${reason || 'Rule-governed workflow update'})`
                );

                actionResult = {
                    patient_id,
                    workflow_status,
                    timestamp: new Date().toISOString()
                };
            } else if (action_type === 'create_emergency_alert') {
                const { patient_id, message, alert_type } = payload;
                const patient = db.prepare('SELECT name, doctor_id FROM patients WHERE id = ?').get(patient_id);
                
                const alertInsert = db.prepare(`
                    INSERT INTO alerts (patient_id, doctor_id, message, status)
                    VALUES (?, ?, ?, 'Active')
                `).run(patient_id, patient ? patient.doctor_id : 1, message);

                const alertId = alertInsert.lastInsertRowid;
                db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(
                    patient_id,
                    `EMERGENCY ALERT: ${message}`
                );

                if (this.io && patient && patient.doctor_id) {
                    this.io.to(`doctor_${patient.doctor_id}`).emit('emergencyAlert', {
                        alertId,
                        patientName: patient.name,
                        message,
                        timestamp: new Date()
                    });
                }

                actionResult = {
                    alert_id: alertId,
                    patient_id,
                    message,
                    alert_type: alert_type || 'STANDARD_ALERT',
                    status: 'Active'
                };
            } else if (action_type === 'allocate_hospital_resource') {
                const { resource_id, patient_id, notes } = payload;
                
                db.prepare(`UPDATE hospital_resources SET status = 'Occupied', current_load = 1 WHERE id = ?`).run(resource_id);
                const resource = db.prepare(`SELECT * FROM hospital_resources WHERE id = ?`).get(resource_id);

                db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(
                    patient_id,
                    `Hospital Resource Assigned: ${resource.name} (${resource.resource_type}) - ${notes || 'Protocol allocation'}`
                );

                actionResult = {
                    resource_id,
                    resource_name: resource.name,
                    resource_type: resource.resource_type,
                    ward: resource.ward,
                    patient_id,
                    status: 'Occupied'
                };
            } else if (action_type === 'schedule_followup') {
                const { patient_id, notes, follow_up_days } = payload;
                const patient = db.prepare('SELECT doctor_id, nurse_id FROM patients WHERE id = ?').get(patient_id);

                const checkupInsert = db.prepare(`
                    INSERT INTO checkups (patient_id, nurse_id, doctor_id, notes, findings)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    patient_id,
                    patient ? patient.nurse_id : 1,
                    patient ? patient.doctor_id : 1,
                    `Automated Follow-up Scheduled (+${follow_up_days || 3} days)`,
                    notes || 'Post-discharge recovery checkup scheduled by clinical protocol'
                );

                db.prepare(`INSERT INTO patient_logs (patient_id, event) VALUES (?, ?)`).run(
                    patient_id,
                    `Clinical Follow-up scheduled (+${follow_up_days || 3} days)`
                );

                actionResult = {
                    checkup_id: checkupInsert.lastInsertRowid,
                    patient_id,
                    notes,
                    scheduled_in_days: follow_up_days || 3
                };
            } else {
                throw new Error(`Unauthorized or unknown workflow action type: ${action_type}`);
            }

            // Persist action in agent_actions table
            const actionRecord = db.prepare(`
                INSERT INTO agent_actions (run_id, action_type, action_payload, status, is_replanned)
                VALUES (?, ?, ?, 'EXECUTED', ?)
            `).run(run_id, action_type, JSON.stringify(actionResult), is_replanned);

            return {
                success: true,
                tool_name: 'Workflow Action Tool',
                duration_ms: Date.now() - start,
                action_id: actionRecord.lastInsertRowid,
                action_type,
                data: actionResult
            };
        } catch (error) {
            db.prepare(`
                INSERT INTO agent_actions (run_id, action_type, action_payload, status, failure_reason, is_replanned)
                VALUES (?, ?, ?, 'FAILED', ?, ?)
            `).run(run_id, action_type, JSON.stringify(payload), error.message, is_replanned);

            return {
                success: false,
                tool_name: 'Workflow Action Tool',
                duration_ms: Date.now() - start,
                error_code: 'ACTION_FAILED',
                message: error.message
            };
        }
    }

    /**
     * 8. Verification Tool: Verify that an action actually produced the intended state change
     */
    async verify_action(action_id, run_id = 'STANDALONE') {
        const start = Date.now();
        try {
            const action = db.prepare('SELECT * FROM agent_actions WHERE id = ?').get(action_id);
            if (!action) {
                return {
                    success: false,
                    tool_name: 'Verification Tool',
                    duration_ms: Date.now() - start,
                    error_code: 'ACTION_NOT_FOUND',
                    message: `Action ID ${action_id} not found in agent log.`
                };
            }

            const payload = JSON.parse(action.action_payload || '{}');
            let verified = false;
            let verificationDetails = {};

            if (action.action_type === 'update_workflow_status') {
                const currentPatient = db.prepare('SELECT workflow_status FROM patients WHERE id = ?').get(payload.patient_id);
                verified = currentPatient && currentPatient.workflow_status === payload.workflow_status;
                verificationDetails = {
                    patient_id: payload.patient_id,
                    expected_status: payload.workflow_status,
                    current_database_status: currentPatient ? currentPatient.workflow_status : null,
                    status_match: verified
                };
            } else if (action.action_type === 'create_emergency_alert') {
                const currentAlert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(payload.alert_id);
                verified = !!(currentAlert && currentAlert.status === 'Active');
                verificationDetails = {
                    alert_id: payload.alert_id,
                    patient_id: payload.patient_id,
                    alert_active: verified,
                    persisted_message: currentAlert ? currentAlert.message : null
                };
            } else if (action.action_type === 'allocate_hospital_resource') {
                const resource = db.prepare('SELECT * FROM hospital_resources WHERE id = ?').get(payload.resource_id);
                verified = !!(resource && resource.status === 'Occupied');
                verificationDetails = {
                    resource_id: payload.resource_id,
                    resource_name: resource ? resource.name : null,
                    resource_type: resource ? resource.resource_type : null,
                    current_status: resource ? resource.status : null,
                    allocated: verified
                };
            } else if (action.action_type === 'schedule_followup') {
                const checkup = db.prepare('SELECT * FROM checkups WHERE id = ?').get(payload.checkup_id);
                verified = !!checkup;
                verificationDetails = {
                    checkup_id: payload.checkup_id,
                    patient_id: payload.patient_id,
                    persisted: verified
                };
            }

            // Persist verification result
            db.prepare(`
                INSERT INTO agent_verifications (run_id, action_id, verified, details)
                VALUES (?, ?, ?, ?)
            `).run(run_id, action_id, verified ? 1 : 0, JSON.stringify(verificationDetails));

            return {
                success: true,
                tool_name: 'Verification Tool',
                duration_ms: Date.now() - start,
                data: {
                    action_id,
                    action_type: action.action_type,
                    verified,
                    details: verificationDetails,
                    summary: verified ? `✓ Action Verified: State change confirmed in database.` : `❌ Verification Failed: State does not match expected output.`
                }
            };
        } catch (error) {
            return {
                success: false,
                tool_name: 'Verification Tool',
                duration_ms: Date.now() - start,
                error_code: 'VERIFICATION_ERROR',
                message: error.message
            };
        }
    }
}

module.exports = AgentTools;
