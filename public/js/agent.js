/**
 * MediMonitor Agent - Frontend Controller
 *
 * Handles Socket.io real-time streaming, scenario selection, timeline rendering,
 * tool inspector drawer, human review modal, and history rehydration.
 */

let socket = null;
if (typeof io !== 'undefined') {
    socket = io();
}

let activeRunId = null;
let currentSelectedScenario = 'scenario_1';
let runToolCallsMap = {};

const SCENARIOS = {
    scenario_1: {
        patient_id: '102',
        goal: 'Process patient case safely under emergency clinical protocol',
        name: 'Deterioration + Resource Failure Replan'
    },
    scenario_2: {
        patient_id: '108',
        goal: 'Cross-reference medication history and process case safely',
        name: 'Medication-Allergy Conflict Escalation'
    },
    scenario_3: {
        patient_id: '115',
        goal: 'Perform post-operative clinical follow-up checkup',
        name: 'Standard Safety Follow-up Protocol'
    }
};

let currentUser = null;
const ROLE_PAGES = {
    'admin': '/admin.html',
    'nurse': '/nurse.html',
    'doctor': '/doctor.html'
};

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            
            // Update staff display in header
            const nameEl = document.getElementById('staff-user-name');
            if (nameEl) {
                nameEl.textContent = `${currentUser.name} (${currentUser.role})`;
            }

            const dashboardLink = document.getElementById('staff-dashboard-link');
            if (dashboardLink) {
                dashboardLink.href = ROLE_PAGES[currentUser.role] || '/';
            }
        } else {
            // Not authenticated -> redirect to login
            location.href = '/login.html';
        }
    } catch (err) {
        console.error('Auth check error:', err);
        location.href = '/login.html';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    initSocketListeners();
    initForm();
    loadRunHistory();

    // Logout button handler
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (err) {
                console.error('Logout failed:', err);
            } finally {
                location.href = '/login.html';
            }
        });
    }
});

// ── 1. SOCKET.IO EVENT HANDLERS ──────────────────────────────────────────
function initSocketListeners() {
    if (!socket) {
        console.warn('Socket.io not available');
        return;
    }

    socket.on('agent:step', (data) => {
        if (activeRunId && data.run_id !== activeRunId) return;

        const { step, current_state, state } = data;
        handleIncomingStep(step, current_state, state);
    });

    socket.on('agent:complete', (data) => {
        if (activeRunId && data.run_id !== activeRunId) return;

        handleRunComplete(data.state);
        loadRunHistory();
    });

    socket.on('agent:acknowledged', (data) => {
        if (activeRunId === data.run_id) {
            const banner = document.getElementById('human-review-container');
            if (banner) banner.style.display = 'none';
            setOverallStatus('ACKNOWLEDGED', 'badge-verified');
        }
        loadRunHistory();
    });
}

// ── 2. SCENARIO SELECTION ────────────────────────────────────────────────
function selectScenario(scenarioKey) {
    currentSelectedScenario = scenarioKey;
    const config = SCENARIOS[scenarioKey];
    if (!config) return;

    document.querySelectorAll('.scenario-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-${scenarioKey.replace('_', '-')}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.getElementById('patient-select').value = config.patient_id;
    document.getElementById('goal-input').value = config.goal;
}

// ── 3. FORM SUBMISSION (RUN AGENT) ───────────────────────────────────────
function initForm() {
    const form = document.getElementById('agent-run-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const patientId = document.getElementById('patient-select').value;
        const goal = document.getElementById('goal-input').value;
        const runBtn = document.getElementById('run-agent-btn');

        runBtn.disabled = true;
        runBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>STARTING...</span>';

        resetDashboardView(patientId, goal);

        try {
            const res = await fetch('/api/agent/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_id: patientId,
                    goal,
                    scenario_id: currentSelectedScenario
                })
            });

            const data = await res.json();
            if (data.run_id) {
                activeRunId = data.run_id;
                setOverallStatus('RUNNING', 'badge-running');
                document.getElementById('case-id-badge').textContent = `Run ID: ${activeRunId}`;
            }
        } catch (err) {
            console.error('Failed to run agent:', err);
            alert('Failed to launch agent run: ' + err.message);
            runBtn.disabled = false;
            runBtn.innerHTML = '<i class="fas fa-play"></i> <span>RUN AGENT</span>';
        }
    });

    // Human Acknowledgment Form
    const ackForm = document.getElementById('human-acknowledge-form');
    if (ackForm) {
        ackForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeRunId) return;

            const signedBy = document.getElementById('reviewer-name-input').value;
            const notes = document.getElementById('reviewer-notes-input').value;

            try {
                const res = await fetch(`/api/agent/acknowledge/${activeRunId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ signed_by: signedBy, reviewer_notes: notes })
                });

                if (res.ok) {
                    closeReviewModal();
                    document.getElementById('human-review-container').style.display = 'none';
                    setOverallStatus('ACKNOWLEDGED', 'badge-verified');
                    alert('Clinical human review successfully recorded.');
                }
            } catch (err) {
                console.error('Failed to acknowledge review:', err);
            }
        });
    }
}

// ── 4. VIEW RESET & STATE INITIALIZATION ─────────────────────────────────
function resetDashboardView(patientId, goal) {
    document.getElementById('timeline-feed').innerHTML = '';
    document.getElementById('active-goal-display').textContent = goal;
    document.getElementById('state-display').textContent = 'INITIALIZING';
    document.getElementById('replan-count-display').textContent = '0';
    document.getElementById('verification-display').textContent = 'Pending';
    document.getElementById('verification-display').style.color = '#f59e0b';
    document.getElementById('final-outcome-badge').textContent = 'Running...';
    document.getElementById('final-outcome-badge').style.color = 'var(--primary-color)';
    document.getElementById('state-observations-list').innerHTML = '<li>Starting observations...</li>';
    document.getElementById('state-actions-list').innerHTML = '<li>None yet</li>';
    document.getElementById('timeline-step-count').textContent = '0 Steps';
    document.getElementById('human-review-container').style.display = 'none';

    // Reset Tool Cards
    resetToolCards();
}

function resetToolCards() {
    const toolKeys = ['patient', 'vitals', 'medications', 'allergies', 'labs', 'resources', 'actions', 'verification'];
    toolKeys.forEach(k => {
        const icon = document.getElementById(`tool-icon-${k}`);
        if (icon) {
            icon.className = 'tool-status-icon tool-idle';
            icon.innerHTML = '<i class="fas fa-circle-notch"></i>';
        }
    });
    runToolCallsMap = {};
}

// ── 5. STEP & STATE RENDERING ────────────────────────────────────────────
function handleIncomingStep(step, currentState, state) {
    // 1. Update State Bar
    document.getElementById('state-display').textContent = (currentState || 'RUNNING').replace('_', ' ');
    if (state && typeof state.replan_count !== 'undefined') {
        document.getElementById('replan-count-display').textContent = state.replan_count;
    }

    // 2. Append Timeline Item
    const timeline = document.getElementById('timeline-feed');
    const item = document.createElement('div');
    item.className = 'timeline-item';

    let badgeColor = 'var(--primary-color)';
    if (step.badge === 'ERROR' || step.badge === 'FAILED' || step.badge === 'CONFLICT' || step.badge === 'CAPACITY_FULL') {
        badgeColor = '#ef4444';
        item.style.borderLeft = '4px solid #ef4444';
    } else if (step.badge === 'REPLANNING' || step.badge === 'DETERIORATING') {
        badgeColor = '#f59e0b';
        item.style.borderLeft = '4px solid #f59e0b';
    } else if (step.badge === 'VERIFIED' || step.badge === 'COMPLETED' || step.badge === 'REALLOCATED') {
        badgeColor = '#10b981';
        item.style.borderLeft = '4px solid #10b981';
    } else {
        item.style.borderLeft = '4px solid var(--primary-color)';
    }

    item.innerHTML = `
        <div class="timeline-icon">${step.icon || '⚙️'}</div>
        <div class="timeline-title">
            <span>${escapeHtml(step.title)}</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                ${step.badge ? `<span style="font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: ${badgeColor}22; color: ${badgeColor}; font-weight: 700;">${step.badge}</span>` : ''}
                <small style="color: var(--secondary-color); font-size: 0.75rem;">${step.timestamp || new Date().toLocaleTimeString()}</small>
            </div>
        </div>
        <div class="timeline-desc">${escapeHtml(step.description)}</div>
    `;

    timeline.appendChild(item);
    timeline.scrollTop = timeline.scrollHeight;

    const countEl = document.getElementById('timeline-step-count');
    if (countEl) {
        countEl.textContent = `${timeline.children.length} Steps`;
    }

    // 3. Highlight Associated Tool Card
    highlightToolFromStep(step.title, step.description, step.badge);

    // 4. Update Observations and Actions
    if (state) {
        if (state.observations && state.observations.length > 0) {
            const obsList = document.getElementById('state-observations-list');
            obsList.innerHTML = state.observations.map(o => `<li>${escapeHtml(o)}</li>`).join('');
        }
        if (state.actions_taken && state.actions_taken.length > 0) {
            const actList = document.getElementById('state-actions-list');
            actList.innerHTML = state.actions_taken.map(a => {
                const text = a.workflow_status ? `Workflow: ${a.workflow_status}` : (a.resource_name ? `Resource: ${a.resource_name}` : (a.message ? `Alert: ${a.message.slice(0, 45)}...` : 'Action executed'));
                return `<li><i class="fas fa-check" style="color: #10b981; font-size: 0.8rem;"></i> ${escapeHtml(text)}</li>`;
            }).join('');
        }
    }
}

function highlightToolFromStep(title, description, badge) {
    const titleLower = title.toLowerCase();
    let toolKey = null;

    if (titleLower.includes('patient record')) toolKey = 'patient';
    else if (titleLower.includes('vital')) toolKey = 'vitals';
    else if (titleLower.includes('medication')) toolKey = 'medications';
    else if (titleLower.includes('allergy')) toolKey = 'allergies';
    else if (titleLower.includes('laboratory') || titleLower.includes('lab')) toolKey = 'labs';
    else if (titleLower.includes('resource')) toolKey = 'resources';
    else if (titleLower.includes('executing') || titleLower.includes('workflow action')) toolKey = 'actions';
    else if (titleLower.includes('verif')) toolKey = 'verification';

    if (toolKey) {
        const icon = document.getElementById(`tool-icon-${toolKey}`);
        if (icon) {
            if (badge === 'CAPACITY_FULL' || badge === 'ERROR' || badge === 'FAILED') {
                icon.className = 'tool-status-icon tool-failed';
                icon.innerHTML = '<i class="fas fa-times"></i>';
            } else {
                icon.className = 'tool-status-icon tool-active';
                icon.innerHTML = '<i class="fas fa-check"></i>';
            }
        }
    }
}

// ── 6. RUN COMPLETE HANDLER ──────────────────────────────────────────────
function handleRunComplete(state) {
    const runBtn = document.getElementById('run-agent-btn');
    if (runBtn) {
        runBtn.disabled = false;
        runBtn.innerHTML = '<i class="fas fa-play"></i> <span>RUN AGENT</span>';
    }

    if (!state) return;

    // Human Review Required
    if (state.human_review_required) {
        setOverallStatus('HUMAN REVIEW REQUIRED', 'badge-escalated');
        document.getElementById('state-display').textContent = 'HUMAN REVIEW REQUIRED';
        document.getElementById('final-outcome-badge').textContent = '🚨 Human Escalation Required';
        document.getElementById('final-outcome-badge').style.color = '#ef4444';

        const banner = document.getElementById('human-review-container');
        banner.style.display = 'block';
        document.getElementById('human-review-reason-text').textContent = state.human_review_reason || 'Consequential clinical uncertainty detected.';

        const evidenceBox = document.getElementById('human-review-evidence-list');
        if (state.human_review_evidence && state.human_review_evidence.length > 0) {
            evidenceBox.innerHTML = state.human_review_evidence.map(e => `
                <div class="evidence-pill">
                    <strong>Evidence:</strong> ${escapeHtml(e.evidence || e)}
                </div>
            `).join('');
        } else {
            evidenceBox.innerHTML = `
                <div class="evidence-pill">
                    <strong>Evidence:</strong> Penicillin allergy (Severe/Anaphylaxis) conflict with active order Ampicillin-Sulbactam.
                </div>
            `;
        }

        // Prepopulate modal
        const modalEvidence = document.getElementById('modal-evidence-box');
        if (modalEvidence) {
            modalEvidence.innerHTML = evidenceBox.innerHTML;
        }
    } 
    // Verified and completed
    else if (state.verification_status === 'verified') {
        setOverallStatus('VERIFIED', 'badge-verified');
        document.getElementById('verification-display').textContent = '✓ Verified';
        document.getElementById('verification-display').style.color = '#10b981';
        document.getElementById('final-outcome-badge').textContent = state.final_outcome || 'Verified and completed';
        document.getElementById('final-outcome-badge').style.color = '#10b981';
    } else {
        setOverallStatus('COMPLETED', 'badge-verified');
        document.getElementById('final-outcome-badge').textContent = state.final_outcome || 'Execution concluded';
    }
}

function setOverallStatus(text, badgeClass) {
    const badge = document.getElementById('agent-overall-badge');
    const statusText = document.getElementById('agent-overall-status');
    const dot = document.getElementById('agent-pulse-dot');

    if (badge) {
        badge.className = `agent-header-badge ${badgeClass}`;
    }
    if (statusText) {
        statusText.textContent = text;
    }
    if (dot) {
        if (badgeClass === 'badge-running') dot.className = 'agent-dot-pulse dot-running';
        else if (badgeClass === 'badge-escalated') dot.className = 'agent-dot-pulse dot-escalated';
        else dot.className = 'agent-dot-pulse dot-verified';
    }
}

// ── 7. LOAD & REHYDRATE RUN HISTORY ──────────────────────────────────────
async function loadRunHistory() {
    const tbody = document.getElementById('runs-history-tbody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/agent/runs?limit=15');
        const runs = await res.json();

        if (!runs || runs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--secondary-color); padding: 2rem;">No previous agent runs recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = runs.map(run => {
            let statusBadge = '<span style="color: #0d9488; font-weight: 600;">Running</span>';
            if (run.status === 'completed') statusBadge = '<span style="color: #10b981; font-weight: 600;">✓ Completed</span>';
            else if (run.status === 'human_review_required') statusBadge = '<span style="color: #ef4444; font-weight: 600;">🚨 Review Req.</span>';
            else if (run.status === 'acknowledged') statusBadge = '<span style="color: #0284c7; font-weight: 600;">Signed-off</span>';

            let verifyBadge = run.verification_status === 'verified' 
                ? '<span style="color: #10b981; font-weight: 600;">✓ Verified</span>' 
                : '<span style="color: #f59e0b;">Pending</span>';

            let humanReviewBadge = run.human_review_required 
                ? '<span style="color: #ef4444; font-weight: 700;">YES</span>' 
                : '<span style="color: var(--secondary-color);">No</span>';

            const timeStr = new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = new Date(run.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' });

            return `
                <tr>
                    <td><strong>#${escapeHtml(run.case_id)}</strong></td>
                    <td>${escapeHtml(run.patient_name || `Patient ${run.patient_id}`)}</td>
                    <td style="max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(run.goal)}</td>
                    <td><small>${dateStr}, ${timeStr}</small></td>
                    <td>${statusBadge}</td>
                    <td><span style="font-weight: 700; color: ${run.replan_count > 0 ? '#f59e0b' : 'var(--secondary-color)'};">${run.replan_count}</span></td>
                    <td>${verifyBadge}</td>
                    <td>${humanReviewBadge}</td>
                    <td>
                        <button type="button" onclick="rehydrateRun('${run.id}')" class="btn" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; background: rgba(13,148,136,0.1); color: var(--primary-color); border: 1px solid rgba(13,148,136,0.3);">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load run history:', err);
    }
}

// ── 8. REHYDRATE A PREVIOUS RUN INTO THE LIVE VIEW ──────────────────────
async function rehydrateRun(runId) {
    try {
        const res = await fetch(`/api/agent/runs/${runId}`);
        const data = await res.json();
        if (!data || !data.run) return;

        const { run, timeline, toolCalls, actions, verifications, state } = data;
        activeRunId = run.id;

        document.getElementById('patient-select').value = run.patient_id;
        document.getElementById('goal-input').value = run.goal;
        document.getElementById('case-id-badge').textContent = `Run ID: ${run.id}`;
        document.getElementById('active-goal-display').textContent = run.goal;
        document.getElementById('state-display').textContent = (run.current_state || 'COMPLETED').replace('_', ' ');
        document.getElementById('replan-count-display').textContent = run.replan_count || '0';
        document.getElementById('verification-display').textContent = run.verification_status === 'verified' ? '✓ Verified' : 'Pending';
        document.getElementById('verification-display').style.color = run.verification_status === 'verified' ? '#10b981' : '#f59e0b';
        document.getElementById('final-outcome-badge').textContent = run.final_outcome || run.status;

        // Render Timeline
        const timelineEl = document.getElementById('timeline-feed');
        timelineEl.innerHTML = '';
        if (timeline && timeline.length > 0) {
            timeline.forEach(step => {
                const item = document.createElement('div');
                item.className = 'timeline-item';
                let badgeColor = 'var(--primary-color)';
                if (step.badge === 'ERROR' || step.badge === 'FAILED' || step.badge === 'CONFLICT' || step.badge === 'CAPACITY_FULL') badgeColor = '#ef4444';
                else if (step.badge === 'REPLANNING' || step.badge === 'DETERIORATING') badgeColor = '#f59e0b';
                else if (step.badge === 'VERIFIED' || step.badge === 'COMPLETED' || step.badge === 'REALLOCATED') badgeColor = '#10b981';

                item.style.borderLeft = `4px solid ${badgeColor}`;
                item.innerHTML = `
                    <div class="timeline-icon">${step.icon || '⚙️'}</div>
                    <div class="timeline-title">
                        <span>${escapeHtml(step.title)}</span>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            ${step.badge ? `<span style="font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: ${badgeColor}22; color: ${badgeColor}; font-weight: 700;">${step.badge}</span>` : ''}
                            <small style="color: var(--secondary-color); font-size: 0.75rem;">${new Date(step.created_at).toLocaleTimeString()}</small>
                        </div>
                    </div>
                    <div class="timeline-desc">${escapeHtml(step.description)}</div>
                `;
                timelineEl.appendChild(item);
            });
            document.getElementById('timeline-step-count').textContent = `${timeline.length} Steps`;
        }

        // Update Tool Cards
        resetToolCards();
        if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach(t => {
                highlightToolFromStep(t.tool_name, '', t.success ? 'VERIFIED' : 'FAILED');
            });
        }

        // Render Memory & Findings
        if (state) {
            if (state.observations && state.observations.length > 0) {
                document.getElementById('state-observations-list').innerHTML = state.observations.map(o => `<li>${escapeHtml(o)}</li>`).join('');
            }
            if (state.actions_taken && state.actions_taken.length > 0) {
                document.getElementById('state-actions-list').innerHTML = state.actions_taken.map(a => {
                    const text = a.workflow_status ? `Workflow: ${a.workflow_status}` : (a.resource_name ? `Resource: ${a.resource_name}` : (a.message ? `Alert: ${a.message.slice(0, 45)}...` : 'Action executed'));
                    return `<li><i class="fas fa-check" style="color: #10b981; font-size: 0.8rem;"></i> ${escapeHtml(text)}</li>`;
                }).join('');
            }
        }

        // Human Review Banner
        const reviewBox = document.getElementById('human-review-container');
        if (run.human_review_required && run.status === 'human_review_required') {
            reviewBox.style.display = 'block';
            document.getElementById('human-review-reason-text').textContent = run.human_review_reason || 'Consequential uncertainty detected.';
            setOverallStatus('HUMAN REVIEW REQUIRED', 'badge-escalated');
        } else if (run.status === 'acknowledged') {
            reviewBox.style.display = 'none';
            setOverallStatus('ACKNOWLEDGED', 'badge-verified');
        } else {
            reviewBox.style.display = 'none';
            setOverallStatus(run.status.toUpperCase(), 'badge-verified');
        }

        // Scroll view to top smoothly
        window.scrollTo({ top: 180, behavior: 'smooth' });
    } catch (err) {
        console.error('Failed to rehydrate run:', err);
    }
}

// ── 9. MODALS ────────────────────────────────────────────────────────────
function openReviewModal() {
    document.getElementById('review-modal').style.display = 'flex';
}

function closeReviewModal() {
    document.getElementById('review-modal').style.display = 'none';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
