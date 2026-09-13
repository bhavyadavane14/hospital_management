# MEDIMONITOR AGENT
### Autonomous Hospital Safety & Clinical Follow-up System

**MediMonitor Agent** transforms conventional hospital monitoring into an autonomous, closed-loop Agentic AI system. It provides continuous patient safety surveillance, deterministic clinical risk classification, protocol-driven resource allocation with autonomous failure replanning, cross-reactivity conflict detection, independent database verification, and human clinical escalation.

---

## 1. System Architecture & Closed-Loop Workflow

Unlike simple chatbots or fixed prompt chains, **MediMonitor Agent** executes an autonomous closed-loop cycle:

```
GOAL
  ↓
OBSERVE (Patient Profile & Context)
  ↓
ASSESS (Information Gap & Safety Check)
  ↓
PLAN (Tool Selection Strategy)
  ↓
SELECT TOOL (Controlled Tool Invocation)
  ↓
GET RESULT (Structured Data Response)
  ↓
UPDATE STATE (Persistent Memory & Observations)
  ↓
TAKE PERMITTED ACTION (Protocol-Governed Workflow Modification)
  ↓
OBSERVE RESULT (Success or Resource Failure?)
  ↓
  ├── [IF RESOURCE FAILURE] → REPLAN → QUERY ALTERNATIVE TOOL → REVISED ACTION
  └── [IF CONFLICT DETECTED] → HALT CLINICAL CHANGE → HUMAN REVIEW REQUIRED
  ↓
VERIFY (Independent Database State Confirmation)
  ↓
SUCCESS / COMPLETE
```

---

## 2. Strict Healthcare Safety Boundaries

Operating in simulated healthcare environments requires unambiguous safety envelopes:
- **No Autonomous Diagnosis**: The agent never claims or issues medical diagnoses.
- **No Autonomous Medication Changes**: The agent never prescribes, changes, or halts prescriptions autonomously.
- **Deterministic Safety Classification**: Clinical risk categorization (`NORMAL`, `ATTENTION_REQUIRED`, `HIGH_PRIORITY`, `EMERGENCY_WORKFLOW`) is computed by deterministic clinical algorithms (`src/agent/safetyRules.js`), not generative LLM hallucinations.
- **Pure Operational Workflow Orchestration**: Permitted actions are restricted to hospital operations (`update_workflow_status`, `allocate_hospital_resource`, `create_emergency_alert`, `schedule_followup`).
- **Human Escalation**: If consequential uncertainty or conflicting records exist, the agent halts and surfaces **`🚨 HUMAN REVIEW REQUIRED`** with full evidence for attending staff review.

---

## 3. Controlled Tool Registry

The Agent interacts with the hospital environment strictly through 8 controlled, auditable tool interfaces:

| # | Tool Name | Function | Purpose |
|---|-----------|----------|---------|
| 1 | **Patient Record Tool** | `get_patient(patient_id)` | Retrieves admission history, demographics, assigned physician, and ward bed. |
| 2 | **Vitals Tool** | `get_patient_vitals(patient_id)` | Queries multi-reading chronological vitals and computes delta trends (e.g. rate of tachycardia, hypoxia). |
| 3 | **Medication Tool** | `get_patient_medications(patient_id)` | Retrieves active and historical prescriptions, dosages, and routes. |
| 4 | **Allergy Tool** | `get_patient_allergies(patient_id)` | Retrieves documented allergens, reaction history, and severity. |
| 5 | **Laboratory Tool** | `get_patient_labs(patient_id)` | Queries clinical diagnostic panels (Troponin, Lactate, WBC, CRP) with reference ranges. |
| 6 | **Hospital Resource Tool** | `get_available_resources(type, opts)` | Queries real-time occupancy across wards, ICU beds, telemetry units, and rapid response units. |
| 7 | **Workflow Action Tool** | `execute_workflow_action(action, payload)` | Executes permitted operational actions (`update_workflow_status`, `allocate_hospital_resource`, `create_emergency_alert`, `schedule_followup`). |
| 8 | **Verification Tool** | `verify_action(action_id)` | Audits the database to confirm that the intended record was actually written and is active. |

---

## 4. Reproducible Hackathon Demo Scenarios

Open the **MediMonitor Agent Dashboard** at `http://localhost:3000/agent.html`:

### Scenario 1: Deterioration + Resource Failure Replan
- **Patient**: P102 (Robert Vance, Age 64)
- **Clinical Picture**: Post-cardiac observation; vital trend detection flags acute tachycardia (HR 110 &rarr; 145 bpm), worsening hypoxia (SpO2 96% &rarr; 88%), and hypotension (BP 88/58 mmHg). Labs indicate elevated Troponin I (0.48 ng/mL).
- **Failure & Adaptation**: The primary protocol calls for an `ICU Bed`, which returns `RESOURCE_UNAVAILABLE` (at maximum occupancy). The agent records the failure, updates state, increments `replan_count = 1`, queries the fallback protocol matrix, and autonomously reallocates to `Step-Down Telemetry Bed 02` with an emergency rapid response alert.
- **Verification**: The Verification Tool queries the database and verifies `Occupied` status and alert persistence.
- **Final Status**: `✓ VERIFIED`.

### Scenario 2: Medication-Allergy Conflict (Human Escalation)
- **Patient**: P108 (Sarah Jenkins, Age 42)
- **Clinical Picture**: Admitted for acute lower respiratory infection.
- **Conflict Detection**: Patient allergy history shows documented **Penicillin Anaphylaxis**. Active medication order includes **Ampicillin-Sulbactam (Unasyn)** (direct beta-lactam cross-reactivity).
- **Safety Boundary Enforced**: Autonomous medication changes are blocked. The agent updates workflow status to `PENDING_HUMAN_REVIEW` and triggers **`🚨 HUMAN REVIEW REQUIRED`** with full evidence breakdown.
- **Human Sign-off**: Staff can click **[ REVIEW CASE & SIGN-OFF ]**, inspect the evidence, submit clinical notes, and return the patient to active monitoring.

### Scenario 3: Standard Safety Follow-up Protocol
- **Patient**: P115 (David Chen, Age 58)
- **Clinical Picture**: Post-operative recovery with stable vital signs (HR 74, BP 120/78, SpO2 98%) and normal labs.
- **Workflow Action**: Schedules a routine clinical follow-up checkup (+3 days) and verifies the entry in the clinical registry.
- **Final Status**: `✓ VERIFIED`.

---

## 5. Getting Started & Running Locally

### Prerequisites
- Node.js (v18+)
- npm

### Installation & Launch
```bash
# Clone the repository
git clone <repo-url>
cd hospital_management-main

# Install dependencies
npm install

# Start the MediMonitor server
npm start
# Or for development:
npm run dev
```

The application will be running at:
- **MediMonitor Agent Dashboard**: `http://localhost:3000/agent.html`
- **Main Landing Page**: `http://localhost:3000`
- **Staff Login**: `http://localhost:3000/login.html`
  - Admin: `admin` / `admin123`
  - Nurse: `nurse1` / `nurse1123`
  - Doctor: `doctor1` / `doctor1123`

### Automated System Verification
To run the automated verification suite covering all 8 tools, safety rules, scenarios, and database assertions:
```bash
node test_agent.js
```

---

## 6. Project Directory Structure

```
hospital_management-main/
├── data/
│   └── medimonitor.db          # SQLite database with clinical & agent tables
├── public/
│   ├── css/
│   │   └── index.css           # Design system & Agent Dashboard styling
│   ├── js/
│   │   ├── app.js              # Hospital core application logic
│   │   └── agent.js            # Agent Dashboard controller & Socket.io stream
│   ├── agent.html              # Dedicated MediMonitor Agent Dashboard
│   ├── doctor.html             # Doctor dashboard (with Agent nav link)
│   ├── nurse.html              # Nurse dashboard (with Agent nav link)
│   ├── admin.html              # Admin dashboard (with Agent nav link)
│   └── index.html              # Landing page (with Agent nav link)
├── src/
│   ├── agent/
│   │   ├── safetyRules.js      # Deterministic classification & protocol matrix
│   │   ├── agentTools.js       # 8 Controlled tool interfaces
│   │   ├── agentState.js       # Persistent state manager
│   │   └── agentController.js  # Closed-loop orchestrator & replanning engine
│   ├── models/
│   │   └── database.js         # SQLite schema migrations & scenario seeds
│   └── routes/
│       ├── agent.js            # Agent REST API routes
│       └── patients.js         # Patient & sub-resource endpoints
├── test_agent.js               # Automated verification test suite
├── .env.example                # Environment configuration template
└── server.js                   # Express server & Socket.io server
```
