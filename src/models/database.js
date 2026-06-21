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

    // Seed initial data
    seedData();
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

module.exports = { db, initDb };
