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
}

module.exports = { db, initDb };
