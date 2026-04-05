const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data/medimonitor.db'));
const info = db.prepare("PRAGMA table_info(patients)").all();
console.log(JSON.stringify(info, null, 2));
db.close();
