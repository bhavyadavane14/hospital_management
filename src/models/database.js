const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', '..', 'data', 'medimonitor.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

function initDb() {
    // Users table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'nurse', 'doctor')),
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Doctors table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS doctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            name TEXT NOT NULL,
            specialization TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `).run();

    // Nurses table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS nurses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            name TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `).run();

    // Beds table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS beds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ward TEXT NOT NULL,
            bed_number TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Occupied', 'ICU')),
            UNIQUE(ward, bed_number)
        )
    `).run();

    // Patients table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            age INTEGER,
            gender TEXT,
            admission_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            doctor_id INTEGER,
            nurse_id INTEGER,
            bed_id INTEGER UNIQUE,
            severity TEXT DEFAULT 'Normal' CHECK(severity IN ('Normal', 'Warning', 'Critical')),
            status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Discharged', 'Pending')),
            FOREIGN KEY (doctor_id) REFERENCES doctors(id),
            FOREIGN KEY (nurse_id) REFERENCES nurses(id),
            FOREIGN KEY (bed_id) REFERENCES beds(id)
        )
    `).run();

    // Checkups table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS checkups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            nurse_id INTEGER NOT NULL,
            doctor_id INTEGER,
            notes TEXT,
            findings TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (nurse_id) REFERENCES nurses(id),
            FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        )
    `).run();

    // Appointments table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER NOT NULL,
            nurse_id INTEGER,
            scheduled_at DATETIME NOT NULL,
            status TEXT DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'Completed', 'Cancelled')),
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES doctors(id),
            FOREIGN KEY (nurse_id) REFERENCES nurses(id)
        )
    `).run();

    // Vitals logs
    db.prepare(`
        CREATE TABLE IF NOT EXISTS vitals_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            heart_rate INTEGER,
            bp_systolic INTEGER,
            bp_diastolic INTEGER,
            temperature REAL,
            oxygen_level INTEGER,
            medicine_given TEXT,
            notes TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Alerts table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            doctor_id INTEGER,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Dismissed')),
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id),
            FOREIGN KEY (doctor_id) REFERENCES doctors(id)
        )
    `).run();

    // Patient logs (Timeline)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS patient_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            event TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Chatbot training data table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS chatbot_training_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            intent TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('faq', 'navigation')),
            response TEXT NOT NULL,
            redirect_url TEXT,
            training_phrases TEXT NOT NULL
        )
    `).run();

    // ── AGENT & CLINICAL EXTENSION TABLES ──────────────────────────────
    try {
        db.prepare(`ALTER TABLE patients ADD COLUMN workflow_status TEXT DEFAULT 'MONITORING'`).run();
    } catch (e) {
        // Column already exists
    }

    // Medications table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS medications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            drug_name TEXT NOT NULL,
            dosage TEXT NOT NULL,
            frequency TEXT,
            route TEXT DEFAULT 'Oral',
            status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Discontinued', 'Held', 'Completed')),
            start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Allergies table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS allergies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            allergen TEXT NOT NULL,
            reaction TEXT,
            severity TEXT DEFAULT 'Moderate' CHECK(severity IN ('Mild', 'Moderate', 'Severe', 'Anaphylaxis')),
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Laboratory results table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS lab_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            test_name TEXT NOT NULL,
            value TEXT NOT NULL,
            numeric_val REAL,
            unit TEXT,
            reference_range TEXT,
            flag TEXT DEFAULT 'NORMAL' CHECK(flag IN ('NORMAL', 'HIGH', 'LOW', 'CRITICAL_HIGH', 'CRITICAL_LOW')),
            collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Hospital Resources table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS hospital_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_type TEXT NOT NULL,
            name TEXT NOT NULL,
            ward TEXT,
            status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Occupied', 'Maintenance', 'Reserved')),
            capacity INTEGER DEFAULT 1,
            current_load INTEGER DEFAULT 0,
            notes TEXT
        )
    `).run();

    // Agent Runs table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL,
            patient_id INTEGER NOT NULL,
            goal TEXT NOT NULL,
            scenario_id TEXT,
            current_state TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            replan_count INTEGER DEFAULT 0,
            verification_status TEXT DEFAULT 'pending',
            human_review_required INTEGER DEFAULT 0,
            human_review_reason TEXT,
            final_outcome TEXT,
            reviewer_notes TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )
    `).run();

    // Agent States table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    `).run();

    // Agent Tool Calls table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            input_payload TEXT,
            output_payload TEXT,
            success INTEGER NOT NULL,
            duration_ms INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    `).run();

    // Agent Actions table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            action_payload TEXT,
            status TEXT NOT NULL,
            failure_reason TEXT,
            is_replanned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    `).run();

    // Agent Verifications table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            action_id INTEGER,
            verified INTEGER NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    `).run();

    // Agent Timeline logs
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            step_index INTEGER NOT NULL,
            icon TEXT,
            title TEXT NOT NULL,
            description TEXT,
            badge TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES agent_runs(id)
        )
    `).run();

    // Seed initial data & synthetic agent scenarios
    seedData();
    seedAgentScenarios();
}

function seedData() {
    // Seed users if empty
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
        const salt = bcrypt.genSaltSync(10);
        
        // Admin
        const adminPass = bcrypt.hashSync('admin123', salt);
        db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('admin', adminPass, 'admin', 'System Admin');
        
        // Nurse
        const nursePass = bcrypt.hashSync('nurse1123', salt);
        const nurseUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?) RETURNING id').get('nurse1', nursePass, 'nurse', 'Nurse Joy');
        db.prepare('INSERT INTO nurses (user_id, name) VALUES (?, ?)').run(nurseUser.id, 'Nurse Joy');
        
        // Doctor
        const doctorPass = bcrypt.hashSync('doctor1123', salt);
        const doctorUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?) RETURNING id').get('doctor1', doctorPass, 'doctor', 'Dr. Strange');
        db.prepare('INSERT INTO doctors (user_id, name, specialization) VALUES (?, ?, ?)').run(doctorUser.id, 'Dr. Strange', 'Cardiology');

        // Beds
        const wards = ['Ward A', 'Ward B', 'ICU'];
        for (const ward of wards) {
            for (let i = 1; i <= 5; i++) {
                const status = ward === 'ICU' ? 'ICU' : 'Available';
                db.prepare('INSERT INTO beds (ward, bed_number, status) VALUES (?, ?, ?)').run(ward, `Bed ${i}`, status);
            }
        }
    }

    // Seed chatbot training data if empty
    const chatbotCount = db.prepare('SELECT COUNT(*) as count FROM chatbot_training_data').get().count;
    if (chatbotCount === 0) {
        const chatbotSeeds = [
            {
                intent: 'faq_demo_accounts',
                category: 'faq',
                response: 'You can log in and test the system using the following demo accounts:<br>• <strong>Admin:</strong> username: <code>admin</code>, password: <code>admin123</code><br>• <strong>Nurse:</strong> username: <code>nurse1</code>, password: <code>nurse1123</code><br>• <strong>Doctor:</strong> username: <code>doctor1</code>, password: <code>doctor1123</code>',
                redirect_url: null,
                training_phrases: 'demo accounts;login details;test credentials;how to log in;what are the passwords;admin login;nurse credentials;doctor password;access dashboard;test logins;login details nurse;login details doctor;login details admin'
            },
            {
                intent: 'faq_real_time_alerts',
                category: 'faq',
                response: 'MediMonitor tracks patient vitals (heart rate, BP, oxygen, and temperature) in real time. If any vital crosses threshold values, the system instantly triggers an audible and visual alarm on the assigned doctor\'s screen. The average response time is under 2 minutes.',
                redirect_url: null,
                training_phrases: 'how do alerts work;what are emergency alerts;alert response time;real time monitoring;how to trigger alert;what happens in emergency;vitals alarm;emergency alarm'
            },
            {
                intent: 'faq_roles',
                category: 'faq',
                response: 'MediMonitor supports three main staff roles:<br>• <strong>Admins:</strong> Manage staff users and view overall hospital occupancy metrics.<br>• <strong>Nurses:</strong> Register new patients, allocate beds/doctors, and record vitals logs.<br>• <strong>Doctors:</strong> Access patient history timelines, add checkup findings, discharge patients, and dismiss emergency alerts.',
                redirect_url: null,
                training_phrases: 'what roles are there;who can use this;user accounts;staff roles;difference between nurse and doctor;admin account;nurse roles;doctor roles'
            },
            {
                intent: 'faq_beds',
                category: 'faq',
                response: 'Our Bed Management system tracks availability across Ward A, Ward B, and the ICU. Once a nurse registers a patient, they can select an available bed and assign a doctor. When the doctor discharges the patient, their bed automatically returns to \'Available\' status.',
                redirect_url: null,
                training_phrases: 'how to allocate bed;assign bed to patient;bed occupancy;how do beds work;icu beds;ward capacity;free up bed;beds available'
            },
            {
                intent: 'faq_security',
                category: 'faq',
                response: 'MediMonitor guarantees high security. All sessions are securely authenticated, passwords hashed using bcrypt, and role-based permissions strictly enforced. Patient data is encrypted and private.',
                redirect_url: null,
                training_phrases: 'is data secure;patient privacy;hipaa compliance;encryption;password security;is it safe;data storage;security protocols'
            },
            {
                intent: 'faq_hardware',
                category: 'faq',
                response: 'No specialized hardware is required! MediMonitor is fully cloud-based. It can integrate with digital bedside monitors via APIs, or staff can manually input vitals using any tablet, mobile phone, or desktop browser.',
                redirect_url: null,
                training_phrases: 'hardware requirements;do we need sensors;monitor integration;devices supported;works on mobile;api integration;bedside monitor integration'
            },
            {
                intent: 'nav_login',
                category: 'navigation',
                response: 'Sure! Let\'s go to the Staff Login page where you can securely access your role-based dashboard.',
                redirect_url: '/login.html',
                training_phrases: 'go to login;take me to sign in;login page;sign in;staff login;access dashboard;how to login;log me in;where is login;nurse login;doctor login;admin login'
            },
            {
                intent: 'nav_features',
                category: 'navigation',
                response: 'Certainly! Let\'s check out the Features page to see our real-time vitals monitoring and emergency alerts.',
                redirect_url: '/features.html',
                training_phrases: 'show features;what can it do;go to features;explore features;capabilities;services;system features;functionalities;what are features'
            },
            {
                intent: 'nav_why_us',
                category: 'navigation',
                response: 'I will guide you to the Why Us page so you can see why hundreds of hospitals trust MediMonitor.',
                redirect_url: '/why-us.html',
                training_phrases: 'why choose us;why medimonitor;why us;benefits;reviews;testimonials;about medimonitor;advantages'
            },
            {
                intent: 'nav_how_it_works',
                category: 'navigation',
                response: 'Let\'s open the How It Works page to review our quick 3-step onboarding process.',
                redirect_url: '/how-it-works.html',
                training_phrases: 'how does it work;how it works;onboarding steps;setup process;getting started;how to start;steps;tutorial'
            },
            {
                intent: 'nav_pricing',
                category: 'navigation',
                response: 'Redirecting you to our Pricing page to explore our subscription options.',
                redirect_url: '/pricing.html',
                training_phrases: 'how much does it cost;pricing plans;pricing;rates;cost;subscription;pricing list;packages;pricing information'
            },
            {
                intent: 'nav_contact_sales',
                category: 'navigation',
                response: 'Understood. Let\'s go to the Contact Sales page so you can get in touch with our team.',
                redirect_url: '/contact-sales.html',
                training_phrases: 'contact sales;contact us;talk to sales;talk to human;support email;phone number;sales team;email support;help line'
            },
            {
                intent: 'nav_documentation',
                category: 'navigation',
                response: 'Opening the Platform Documentation page to explore help manuals and APIs.',
                redirect_url: '/documentation.html',
                training_phrases: 'documentation;docs;help guides;api documentation;user manual;docs page;troubleshooting documentation;guides'
            },
            {
                intent: 'nav_home',
                category: 'navigation',
                response: 'Sure, I will take you back to the home page.',
                redirect_url: '/',
                training_phrases: 'go to home;back to home;home page;main page;exit to home;return to homepage;restart;home'
            }
        ];

        const stmt = db.prepare('INSERT INTO chatbot_training_data (intent, category, response, redirect_url, training_phrases) VALUES (?, ?, ?, ?, ?)');
        for (const seed of chatbotSeeds) {
            stmt.run(seed.intent, seed.category, seed.response, seed.redirect_url, seed.training_phrases);
        }
    }
}

function seedAgentScenarios() {
    // 0. Ensure synthetic patients P102, P108, P115 exist before foreign keys
    db.prepare(`
        INSERT OR IGNORE INTO patients (id, name, age, gender, doctor_id, nurse_id, bed_id, severity, status, workflow_status)
        VALUES (102, 'Robert Vance', 64, 'Male', 1, 1, 5, 'Warning', 'Active', 'MONITORING')
    `).run();

    // Ensure STANDALONE run exists for standalone tool testing
    db.prepare(`
        INSERT OR IGNORE INTO agent_runs (id, case_id, patient_id, goal, current_state, status)
        VALUES ('STANDALONE', 'STANDALONE', 102, 'Standalone Tool Invocation', 'INITIALIZED', 'completed')
    `).run();

    // 1. Seed Hospital Resources if empty
    const resourceCount = db.prepare('SELECT COUNT(*) as count FROM hospital_resources').get().count;
    if (resourceCount === 0) {
        const insertResource = db.prepare(`
            INSERT INTO hospital_resources (resource_type, name, ward, status, capacity, current_load, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // ICU Beds (Simulate primary emergency resource unavailability for scenario 1 replan)
        insertResource.run('ICU Bed', 'ICU Bed 01', 'ICU', 'Occupied', 1, 1, 'Occupied - Severe acute respiratory distress case');
        insertResource.run('ICU Bed', 'ICU Bed 02', 'ICU', 'Occupied', 1, 1, 'Occupied - Post-CABG stabilization');
        // Alternative Step-down Telemetry Beds
        insertResource.run('Step-Down Telemetry Bed', 'Step-Down Bed 01', 'Telemetry Unit', 'Occupied', 1, 1, 'Occupied - Arrhythmia monitoring');
        insertResource.run('Step-Down Telemetry Bed', 'Step-Down Bed 02', 'Telemetry Unit', 'Available', 1, 0, 'Available - Continuous ECG & Pulse Oximetry Telemetry Ready');
        // Rapid Response & Support Resources
        insertResource.run('Rapid Response Team', 'RRT Unit Alpha', 'Hospital-Wide', 'Available', 1, 0, 'Available - Critical Care Nurse & RT on rapid dispatch standby');
        insertResource.run('Emergency Crash Cart', 'Crash Cart #3', 'Ward A', 'Available', 1, 0, 'Available - Defibrillator & emergency airway kit inspected');
        insertResource.run('Clinical Follow-up Clinic', 'Post-Op Follow-up Suite', 'Ambulatory Wing', 'Available', 10, 2, 'Available - Routine post-discharge clinical consultation');
    } else {
        // Ensure Step-Down Bed 02 is Available for replanning demos
        db.prepare(`UPDATE hospital_resources SET status = 'Available' WHERE name = 'Step-Down Bed 02'`).run();
        db.prepare(`UPDATE hospital_resources SET status = 'Occupied' WHERE name IN ('ICU Bed 01', 'ICU Bed 02')`).run();
    }

    // Patient 108: Sarah Jenkins (Scenario 2: Medication-Allergy Conflict -> Human Review)
    db.prepare(`
        INSERT OR IGNORE INTO patients (id, name, age, gender, doctor_id, nurse_id, bed_id, severity, status, workflow_status)
        VALUES (108, 'Sarah Jenkins', 42, 'Female', 1, 1, 7, 'Warning', 'Active', 'MONITORING')
    `).run();

    // Patient 115: David Chen (Scenario 3: Standard Safety Follow-up & Verification)
    db.prepare(`
        INSERT OR IGNORE INTO patients (id, name, age, gender, doctor_id, nurse_id, bed_id, severity, status, workflow_status)
        VALUES (115, 'David Chen', 58, 'Male', 1, 1, 8, 'Normal', 'Active', 'MONITORING')
    `).run();

    // 3. Seed Vitals for P102 (Deteriorating series to trigger trend detection)
    const p102VitalsCount = db.prepare('SELECT COUNT(*) as count FROM vitals_logs WHERE patient_id = 102').get().count;
    if (p102VitalsCount === 0) {
        const insertVitals = db.prepare(`
            INSERT INTO vitals_logs (patient_id, heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
        `);
        insertVitals.run(102, 110, 135, 85, 99.1, 96, 'Aspirin 81mg', 'Baseline post-observation reading', '-45 minutes');
        insertVitals.run(102, 125, 120, 75, 99.8, 93, 'None', 'Patient reports onset of mild chest tightness', '-30 minutes');
        insertVitals.run(102, 138, 105, 65, 100.4, 90, 'Supplemental O2 2L', 'Increasing diaphoresis and tachypnea', '-15 minutes');
        insertVitals.run(102, 145, 88, 58, 101.2, 88, 'None', 'Marked tachycardia, hypotension, worsening hypoxia', '-2 minutes');
    }

    // 4. Seed Labs for P102
    const p102LabsCount = db.prepare('SELECT COUNT(*) as count FROM lab_results WHERE patient_id = 102').get().count;
    if (p102LabsCount === 0) {
        const insertLab = db.prepare(`
            INSERT INTO lab_results (patient_id, test_name, value, numeric_val, unit, reference_range, flag)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertLab.run(102, 'Troponin I', '0.48', 0.48, 'ng/mL', '< 0.04', 'CRITICAL_HIGH');
        insertLab.run(102, 'Lactate', '2.9', 2.9, 'mmol/L', '0.5 - 2.0', 'HIGH');
        insertLab.run(102, 'Serum Potassium', '3.8', 3.8, 'mmol/L', '3.5 - 5.0', 'NORMAL');
        insertLab.run(102, 'Hemoglobin', '13.2', 13.2, 'g/dL', '13.0 - 17.0', 'NORMAL');
    }

    // 5. Seed Medications for P102
    const p102MedCount = db.prepare('SELECT COUNT(*) as count FROM medications WHERE patient_id = 102').get().count;
    if (p102MedCount === 0) {
        const insertMed = db.prepare(`
            INSERT INTO medications (patient_id, drug_name, dosage, frequency, route, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertMed.run(102, 'Aspirin', '81 mg', 'Once daily', 'Oral', 'Active');
        insertMed.run(102, 'Metoprolol Tartrate', '25 mg', 'Twice daily', 'Oral', 'Active');
    }

    // 6. Seed Allergies for P102
    const p102AllergyCount = db.prepare('SELECT COUNT(*) as count FROM allergies WHERE patient_id = 102').get().count;
    if (p102AllergyCount === 0) {
        db.prepare(`
            INSERT INTO allergies (patient_id, allergen, reaction, severity)
            VALUES (102, 'Sulfa Drugs', 'Cutaneous Erythema & Pruritus', 'Moderate')
        `).run();
    }

    // 7. Seed P108 (Sarah Jenkins - Penicillin Allergy vs Ampicillin Order Conflict)
    const p108AllergyCount = db.prepare('SELECT COUNT(*) as count FROM allergies WHERE patient_id = 108').get().count;
    if (p108AllergyCount === 0) {
        db.prepare(`
            INSERT INTO allergies (patient_id, allergen, reaction, severity)
            VALUES (108, 'Penicillin', 'Anaphylaxis / Laryngeal Edema & Bronchospasm', 'Anaphylaxis')
        `).run();
    }

    const p108MedCount = db.prepare('SELECT COUNT(*) as count FROM medications WHERE patient_id = 108').get().count;
    if (p108MedCount === 0) {
        const insertMed = db.prepare(`
            INSERT INTO medications (patient_id, drug_name, dosage, frequency, route, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertMed.run(108, 'Ampicillin-Sulbactam (Unasyn)', '1.5 g', 'Every 6 hours', 'IV', 'Active');
        insertMed.run(108, 'Acetaminophen', '650 mg', 'Every 6 hours PRN', 'Oral', 'Active');
    }

    const p108VitalsCount = db.prepare('SELECT COUNT(*) as count FROM vitals_logs WHERE patient_id = 108').get().count;
    if (p108VitalsCount === 0) {
        db.prepare(`
            INSERT INTO vitals_logs (patient_id, heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes)
            VALUES (108, 98, 118, 74, 101.4, 94, 'Acetaminophen 650mg', 'Admitted with suspected lower respiratory tract infection')
        `).run();
    }

    const p108LabsCount = db.prepare('SELECT COUNT(*) as count FROM lab_results WHERE patient_id = 108').get().count;
    if (p108LabsCount === 0) {
        db.prepare(`
            INSERT INTO lab_results (patient_id, test_name, value, numeric_val, unit, reference_range, flag)
            VALUES (108, 'WBC Count', '14.8', 14.8, '10^3/uL', '4.5 - 11.0', 'HIGH')
        `).run();
    }

    // 8. Seed P115 (David Chen - Post-Op Stable Clinical Follow-up)
    const p115VitalsCount = db.prepare('SELECT COUNT(*) as count FROM vitals_logs WHERE patient_id = 115').get().count;
    if (p115VitalsCount === 0) {
        db.prepare(`
            INSERT INTO vitals_logs (patient_id, heart_rate, bp_systolic, bp_diastolic, temperature, oxygen_level, medicine_given, notes)
            VALUES (115, 74, 120, 78, 98.4, 98, 'Enoxaparin 40mg', 'Post-operative Day 2 - Mobilizing well')
        `).run();
    }

    const p115LabsCount = db.prepare('SELECT COUNT(*) as count FROM lab_results WHERE patient_id = 115').get().count;
    if (p115LabsCount === 0) {
        db.prepare(`
            INSERT INTO lab_results (patient_id, test_name, value, numeric_val, unit, reference_range, flag)
            VALUES (115, 'Hemoglobin', '13.8', 13.8, 'g/dL', '13.5 - 17.5', 'NORMAL')
        `).run();
        db.prepare(`
            INSERT INTO lab_results (patient_id, test_name, value, numeric_val, unit, reference_range, flag)
            VALUES (115, 'WBC Count', '6.5', 6.5, '10^3/uL', '4.5 - 11.0', 'NORMAL')
        `).run();
    }

    const p115MedCount = db.prepare('SELECT COUNT(*) as count FROM medications WHERE patient_id = 115').get().count;
    if (p115MedCount === 0) {
        db.prepare(`
            INSERT INTO medications (patient_id, drug_name, dosage, frequency, route, status)
            VALUES (115, 'Enoxaparin', '40 mg', 'Once daily', 'Subcutaneous', 'Active')
        `).run();
    }
}

module.exports = { db, initDb };
