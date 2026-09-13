/**
 * MediMonitor Agent - Deterministic Safety Rules & Workflow Protocol Matrix
 *
 * STRICT SAFETY BOUNDARY:
 * - This module enforces deterministic classification and simulated workflow rules.
 * - The system does NOT diagnose diseases, prescribe medication, or alter clinical orders.
 * - Clinical risk categorization is strictly deterministic.
 * - If consequential uncertainty or conflicting records exist, HUMAN REVIEW REQUIRED is triggered.
 */

// ── 1. DRUG-ALLERGY CROSS-REACTIVITY MATRIX ──────────────────────────────
const DRUG_ALLERGY_MAP = {
    penicillin: [
        'penicillin', 'ampicillin', 'amoxicillin', 'piperacillin', 'ticarcillin',
        'unasyn', 'ampicillin-sulbactam', 'augmentin', 'zosyn', 'piperacillin-tazobactam'
    ],
    cephalosporin: [
        'cefazolin', 'ceftriaxone', 'cefepime', 'cephalexin', 'cefotaxime', 'ceftazidime'
    ],
    sulfa: [
        'sulfa', 'sulfamethoxazole', 'bactrim', 'septra', 'silver sulfadiazine', 'sulfasalazine'
    ],
    nsaid: [
        'aspirin', 'ibuprofen', 'ketorolac', 'naproxen', 'toradol', 'meloxicam', 'indomethacin'
    ]
};

/**
 * Check for potential drug-allergy record conflict deterministically
 * @param {Array} allergies - List of recorded patient allergies
 * @param {Array} medications - List of active patient medications
 * @returns {Object} Conflict assessment result
 */
function detectMedicationAllergyConflict(allergies = [], medications = []) {
    if (!allergies.length || !medications.length) {
        return { conflictDetected: false, conflicts: [] };
    }

    const conflicts = [];

    for (const allergy of allergies) {
        const allergenLower = (allergy.allergen || '').toLowerCase();

        // Determine cross-reactive drug classes
        let reactiveTerms = [allergenLower];
        for (const [groupName, groupTerms] of Object.entries(DRUG_ALLERGY_MAP)) {
            if (allergenLower.includes(groupName) || groupTerms.some(t => allergenLower.includes(t))) {
                reactiveTerms = [...new Set([...reactiveTerms, ...groupTerms])];
                break;
            }
        }

        for (const med of medications) {
            const medNameLower = (med.drug_name || '').toLowerCase();
            const isMatch = reactiveTerms.some(term => medNameLower.includes(term));

            if (isMatch && med.status !== 'Discontinued') {
                conflicts.push({
                    allergen: allergy.allergen,
                    allergySeverity: allergy.severity || 'Moderate',
                    allergyReaction: allergy.reaction || 'Documented allergic reaction',
                    medication: med.drug_name,
                    dosage: med.dosage,
                    route: med.route || 'Oral',
                    status: med.status,
                    evidence: `Recorded Allergy: "${allergy.allergen}" (${allergy.severity} - ${allergy.reaction || 'Reaction recorded'}) matches active medication order "${med.drug_name}".`
                });
            }
        }
    }

    if (conflicts.length > 0) {
        return {
            conflictDetected: true,
            conflicts,
            recommendation: 'HUMAN REVIEW REQUIRED',
            humanReviewReason: 'Potential drug-allergy record conflict detected. Autonomous medication adjustment is strictly prohibited.',
            evidenceSummary: conflicts.map(c => c.evidence).join(' | ')
        };
    }

    return { conflictDetected: false, conflicts: [] };
}

// ── 2. VITAL TREND DETECTION ENGINE ───────────────────────────────────────
/**
 * Detect significant trends across chronological vitals logs
 * @param {Array} vitalsLogs - Sorted descending or ascending vitals logs
 * @returns {Object} Trend detection summary
 */
function evaluateVitalsTrend(vitalsLogs = []) {
    if (!vitalsLogs || vitalsLogs.length === 0) {
        return {
            hasTrend: false,
            classification: 'NO_DATA',
            summary: 'No historical vital readings recorded'
        };
    }

    // Sort chronologically ascending for trend analysis
    const chronological = [...vitalsLogs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const latest = chronological[chronological.length - 1];
    const earliest = chronological[0];

    const count = chronological.length;
    let hrWorsening = false;
    let o2Worsening = false;
    let bpWorsening = false;

    let deltaHR = 0;
    let deltaO2 = 0;
    let deltaSystolic = 0;

    if (count >= 2) {
        deltaHR = (latest.heart_rate || 0) - (earliest.heart_rate || 0);
        deltaO2 = (latest.oxygen_level || 0) - (earliest.oxygen_level || 0);
        deltaSystolic = (latest.bp_systolic || 0) - (earliest.bp_systolic || 0);

        // Heart rate climbing by > 20 bpm, or latest > 130
        if (deltaHR >= 20 || (latest.heart_rate && latest.heart_rate >= 130)) {
            hrWorsening = true;
        }

        // SpO2 dropping by >= 5%, or latest < 90%
        if (deltaO2 <= -4 || (latest.oxygen_level && latest.oxygen_level < 92)) {
            o2Worsening = true;
        }

        // Systolic BP dropping by >= 25 mmHg, or latest < 90 mmHg
        if (deltaSystolic <= -25 || (latest.bp_systolic && latest.bp_systolic < 90)) {
            bpWorsening = true;
        }
    }

    const isWorsening = hrWorsening || o2Worsening || bpWorsening;
    const isCritical = (hrWorsening && o2Worsening) || (latest.oxygen_level < 90) || (latest.bp_systolic < 90);

    let classification = 'NORMAL';
    if (isCritical) {
        classification = 'EMERGENCY_WORKFLOW';
    } else if (isWorsening) {
        classification = 'HIGH_PRIORITY';
    } else if (latest.heart_rate > 100 || latest.oxygen_level < 95) {
        classification = 'ATTENTION_REQUIRED';
    }

    const trendNotes = [];
    if (hrWorsening) trendNotes.push(`Tachycardia progression: ${earliest.heart_rate} -> ${latest.heart_rate} bpm (+${deltaHR} bpm)`);
    if (o2Worsening) trendNotes.push(`Hypoxia progression: ${earliest.oxygen_level}% -> ${latest.oxygen_level}% (${deltaO2}%)`);
    if (bpWorsening) trendNotes.push(`Hemodynamic drop: ${earliest.bp_systolic}/${earliest.bp_diastolic} -> ${latest.bp_systolic}/${latest.bp_diastolic} mmHg`);

    return {
        hasTrend: count >= 2,
        readingsCount: count,
        latestReading: latest,
        earliestReading: earliest,
        isWorsening,
        classification,
        trendNotes,
        summary: trendNotes.length > 0 
            ? `Significant worsening trend: ${trendNotes.join('; ')}`
            : `Vitals stable across ${count} readings (HR: ${latest.heart_rate || 'N/A'}, O2: ${latest.oxygen_level || 'N/A'}%)`
    };
}

// ── 3. DETERMINISTIC CLINICAL RISK EVALUATION ──────────────────────────────
/**
 * Evaluates patient state strictly using deterministic safety rules
 * @param {Object} patient - Patient record
 * @param {Array} vitals - Vitals logs
 * @param {Array} labs - Laboratory test results
 * @param {Array} allergies - Patient allergies
 * @param {Array} medications - Patient medications
 * @returns {Object} Deterministic classification and safety status
 */
function evaluateDeterministicSafety({ patient, vitals = [], labs = [], allergies = [], medications = [] }) {
    const trendAnalysis = evaluateVitalsTrend(vitals);
    const conflictAnalysis = detectMedicationAllergyConflict(allergies, medications);

    // Evaluate Lab Flags
    const criticalLabs = labs.filter(l => l.flag === 'CRITICAL_HIGH' || l.flag === 'CRITICAL_LOW');
    const highLabs = labs.filter(l => l.flag === 'HIGH' || l.flag === 'LOW');

    let deterministicClassification = 'NORMAL';
    const classificationReasons = [];

    if (conflictAnalysis.conflictDetected) {
        // Drug conflict takes precedence for Human Escalation
        deterministicClassification = 'PENDING_HUMAN_REVIEW';
        classificationReasons.push('Potential medication-allergy conflict detected');
    } else if (trendAnalysis.classification === 'EMERGENCY_WORKFLOW' || criticalLabs.length > 0) {
        deterministicClassification = 'EMERGENCY_WORKFLOW';
        if (trendAnalysis.classification === 'EMERGENCY_WORKFLOW') classificationReasons.push(trendAnalysis.summary);
        if (criticalLabs.length > 0) {
            classificationReasons.push(`Critical lab values: ${criticalLabs.map(l => `${l.test_name} (${l.value} ${l.unit})`).join(', ')}`);
        }
    } else if (trendAnalysis.classification === 'HIGH_PRIORITY' || highLabs.length > 0) {
        deterministicClassification = 'HIGH_PRIORITY';
        if (trendAnalysis.classification === 'HIGH_PRIORITY') classificationReasons.push(trendAnalysis.summary);
        if (highLabs.length > 0) {
            classificationReasons.push(`Abnormal labs: ${highLabs.map(l => `${l.test_name} (${l.value} ${l.unit})`).join(', ')}`);
        }
    } else if (trendAnalysis.classification === 'ATTENTION_REQUIRED') {
        deterministicClassification = 'ATTENTION_REQUIRED';
        classificationReasons.push('Sub-acute vital reading requiring monitoring');
    } else {
        classificationReasons.push('Vital parameters and laboratory markers within safe baseline tolerances');
    }

    return {
        classification: deterministicClassification,
        reasons: classificationReasons,
        trendAnalysis,
        conflictAnalysis,
        criticalLabs,
        requiresHumanReview: conflictAnalysis.conflictDetected
    };
}

// ── 4. PREDEFINED SIMULATED WORKFLOW & RESOURCE PROTOCOL MATRIX ───────────
/**
 * Maps deterministic classification to predefined hospital workflow rules.
 * Resource allocation is rule-governed, not an autonomous clinical decision.
 */
const WORKFLOW_PROTOCOL_MATRIX = {
    EMERGENCY_WORKFLOW: {
        targetWorkflowStatus: 'EMERGENCY_ESCALATION',
        allowedActions: ['allocate_hospital_resource', 'create_emergency_alert', 'update_workflow_status'],
        resourceProtocol: {
            primaryType: 'ICU Bed',
            fallbackType: 'Step-Down Telemetry Bed',
            requiresSecondaryAlert: true,
            secondaryAlertType: 'RAPID_RESPONSE_ALERT'
        },
        requiresVerification: true
    },
    HIGH_PRIORITY: {
        targetWorkflowStatus: 'STEPDOWN_TRANSITION',
        allowedActions: ['allocate_hospital_resource', 'create_emergency_alert', 'update_workflow_status'],
        resourceProtocol: {
            primaryType: 'Step-Down Telemetry Bed',
            fallbackType: 'Emergency Isolation Room',
            requiresSecondaryAlert: true,
            secondaryAlertType: 'URGENT_EVALUATION_ALERT'
        },
        requiresVerification: true
    },
    PENDING_HUMAN_REVIEW: {
        targetWorkflowStatus: 'PENDING_HUMAN_REVIEW',
        allowedActions: ['create_emergency_alert', 'update_workflow_status'],
        resourceProtocol: null,
        requiresVerification: true,
        blockClinicalChanges: true
    },
    ATTENTION_REQUIRED: {
        targetWorkflowStatus: 'MONITORING',
        allowedActions: ['create_emergency_alert', 'schedule_followup', 'update_workflow_status'],
        resourceProtocol: {
            primaryType: 'Step-Down Telemetry Bed',
            fallbackType: 'Clinical Follow-up Clinic',
            requiresSecondaryAlert: false
        },
        requiresVerification: true
    },
    NORMAL: {
        targetWorkflowStatus: 'ROUTINE_FOLLOWUP',
        allowedActions: ['schedule_followup', 'update_workflow_status'],
        resourceProtocol: {
            primaryType: 'Clinical Follow-up Clinic',
            fallbackType: null,
            requiresSecondaryAlert: false
        },
        requiresVerification: true
    }
};

/**
 * Get workflow protocol for a given deterministic classification
 * @param {string} classification
 * @returns {Object} Workflow protocol definition
 */
function getWorkflowProtocol(classification) {
    return WORKFLOW_PROTOCOL_MATRIX[classification] || WORKFLOW_PROTOCOL_MATRIX.NORMAL;
}

module.exports = {
    detectMedicationAllergyConflict,
    evaluateVitalsTrend,
    evaluateDeterministicSafety,
    getWorkflowProtocol,
    WORKFLOW_PROTOCOL_MATRIX,
    DRUG_ALLERGY_MAP
};
