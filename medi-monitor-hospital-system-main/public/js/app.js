// MediMonitor Frontend Application Logic
let socket = null;
if (typeof io !== 'undefined') {
    socket = io();
}
let currentUser = null;

const ROLE_PAGES = {
    'admin': '/admin.html',
    'nurse': '/nurse.html',
    'doctor': '/doctor.html'
};

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    await checkAuth();

    // Handle Login
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.error) {
                    const errorEl = document.getElementById('login-error');
                    if (errorEl) {
                        errorEl.textContent = data.error;
                        errorEl.style.display = 'block';
                    }
                } else {
                    location.href = ROLE_PAGES[data.user.role] || '/';
                }
            } catch (err) {
                console.error(err);
            }
        });
    }

    // Handle Logout with delegation to be safe
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('#logout-btn');
        if (btn) {
            e.preventDefault();
            console.log('Logging out...');
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (err) {
                console.error('Logout request failed', err);
            } finally {
                location.href = '/login.html';
            }
        }
    });

    // Update homepage if logged in
    if (location.pathname === '/' || location.pathname.includes('index.html')) {
        const navUl = document.querySelector('nav ul');
        if (navUl && currentUser) {
            const li = document.createElement('li');
            li.innerHTML = `<a href="${ROLE_PAGES[currentUser.role]}" class="btn btn-primary" style="color: white;">Go to Dashboard</a>`;
            navUl.appendChild(li);
        }
    }

    // Hamburger Menu Toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    // Discharge History Hamburger logic
    const historyBtn = document.getElementById('history-hamburger');
    if (historyBtn) {
        historyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadDischargeHistory();
        });
    }

    // Initialize Dashboard based on role
    if (currentUser) {
        const path = location.pathname;
        if (path.endsWith('nurse.html')) initNurseDashboard();
        if (path.endsWith('doctor.html')) initDoctorDashboard();
        if (path.endsWith('admin.html')) initAdminDashboard();
        
        // Join socket room
        if (currentUser.role === 'doctor' && currentUser.doctorId) {
            socket.emit('joinRoom', `doctor_${currentUser.doctorId}`);
        }
    }
});

async function loadDischargeHistory() {
    const res = await fetch('/api/patients?status=Discharged');
    const patients = await res.json();
    
    let historyHtml = `<h3>Discharge History</h3><div style="max-height: 400px; overflow-y: auto;">`;
    if (patients.length === 0) historyHtml += '<p>No discharged patients found.</p>';
    
    patients.forEach(p => {
        historyHtml += `
            <div class="glass" style="padding: 1rem; margin-bottom: 0.5rem; border-left: 5px solid var(--secondary-color);">
                <strong>${p.name}</strong> (ID: #${p.id})<br>
                <small>Admission: ${new Date(p.admission_time).toLocaleDateString()}</small><br>
                <small>Doctor: ${p.doctor_name || 'N/A'}</small>
            </div>
        `;
    });
    historyHtml += '</div><button onclick="this.parentElement.remove()" class="btn" style="margin-top: 1rem;">Close</button>';
    
    const div = document.createElement('div');
    div.className = 'glass';
    div.style.position = 'fixed';
    div.style.top = '10%';
    div.style.left = '25%';
    div.style.width = '50%';
    div.style.padding = '2rem';
    div.style.zIndex = '10000';
    div.innerHTML = historyHtml;
    document.body.appendChild(div);
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            
            const currentPage = location.pathname;
            const expectedPage = ROLE_PAGES[currentUser.role];

            // Redirect if on login page or wrong dashboard
            if (currentPage.includes('login.html')) {
                location.href = expectedPage;
            } else if (Object.values(ROLE_PAGES).includes(currentPage) && currentPage !== expectedPage) {
                location.href = expectedPage;
            }
        } else {
            // Redirect to login if on any dashboard page
            const dashboards = Object.values(ROLE_PAGES);
            if (dashboards.some(page => location.pathname.includes(page))) {
                location.href = '/login.html';
            }
        }
    } catch (err) {
        console.error('Auth check failed', err);
    }
}

// NURSE DASHBOARD LOGIC
async function initNurseDashboard() {
    document.getElementById('nurse-name').textContent = currentUser.name;
    loadNursePatients();
    loadBedStats();
    loadDoctorsForSelect();

    // Search functionality (AOA: Searching)
    document.getElementById('patient-search').addEventListener('input', (e) => {
        loadNursePatients(e.target.value);
    });

    // Register Patient
    document.getElementById('register-patient-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const patientData = {
            name: document.getElementById('p-name').value,
            age: document.getElementById('p-age').value,
            gender: document.getElementById('p-gender').value
        };

        const res = await fetch('/api/patients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patientData)
        });
        
        if (res.ok) {
            alert('Patient registered! Admin will allocate a bed and doctor soon.');
            document.getElementById('register-patient-form').reset();
            loadNursePatients();
            loadBedStats();
        } else {
            const data = await res.json();
            alert(data.error);
        }
    });

    // Vitals Form
    document.getElementById('vitals-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pId = document.getElementById('vitals-form').dataset.pId;
        const vitals = {
            heart_rate: document.getElementById('v-hr').value,
            bp_systolic: document.getElementById('v-bps').value,
            bp_diastolic: document.getElementById('v-bpd').value,
            temperature: document.getElementById('v-temp').value,
            oxygen_level: document.getElementById('v-o2').value,
            medicine_given: document.getElementById('v-med').value,
            notes: document.getElementById('v-notes').value
        };

        const res = await fetch(`/api/patients/${pId}/vitals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vitals)
        });

        if (res.ok) {
            const data = await res.json();
            alert(`Vitals updated. Calculated Severity: ${data.severity}`);
            closeVitalsModal();
            loadNursePatients();
        }
    });

    // Handle Manual Alert Button
    document.addEventListener('click', async (e) => {
        if (e.target.closest('.trigger-alert-btn')) {
            const pId = e.target.closest('.trigger-alert-btn').dataset.id;
            const msg = prompt("Enter emergency message (optional):");
            if (msg !== null) {
                const res = await fetch(`/api/patients/${pId}/alert`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg })
                });
                if (res.ok) alert('Emergency alert sent to assigned doctor!');
            }
        }
    });
}

async function loadNursePatients(search = '', status = 'Active') {
    const res = await fetch(`/api/patients?search=${search}&status=${status}`);
    const patients = await res.json();
    const tableBody = document.querySelector('#nurse-patient-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    patients.forEach(p => {
        const tr = document.createElement('tr');
        const isPending = p.status === 'Pending';
        tr.innerHTML = `
            <td>#${p.id}</td>
            <td>${p.name}</td>
            <td>${isPending ? '<span class="badge">Awaiting Bed</span>' : `${p.ward} - ${p.bed_number}`}</td>
            <td><span class="severity-${p.severity.toLowerCase()}">${p.severity}</span></td>
            <td>
                ${!isPending ? `
                    <button class="btn btn-primary" onclick="openVitalsModal(${p.id}, '${p.name}')" style="padding: 5px 10px;">Vitals</button>
                    <button class="btn trigger-alert-btn" data-id="${p.id}" style="padding: 5px 10px; background: var(--danger-color); color: white;"><i class="fas fa-bell"></i> Alert</button>
                ` : '<em>In Transit...</em>'}
            </td>
        `;
        tableBody.appendChild(tr);
    });
    document.getElementById('stat-patients').textContent = patients.length;
}

function openVitalsModal(id, name) {
    document.getElementById('vitals-modal').style.display = 'block';
    document.getElementById('modal-patient-name').textContent = name;
    document.getElementById('vitals-form').dataset.pId = id;
}

function closeVitalsModal() {
    document.getElementById('vitals-modal').style.display = 'none';
    document.getElementById('vitals-form').reset();
}

// DOCTOR DASHBOARD LOGIC
async function initDoctorDashboard() {
    document.getElementById('doctor-name').textContent = currentUser.name;
    loadDoctorPatients();

    // Socket.io Listener for Real-Time Alerts (OS: Interrupts)
    socket.on('emergencyAlert', (data) => {
        showEmergencyAlert(data);
    });
}

async function loadDoctorPatients() {
    // AOA: Fetching with Priority (Critical first)
    const res = await fetch(`/api/patients?status=Active`);
    const patients = await res.json();
    const tableBody = document.querySelector('#doctor-patient-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    patients.forEach(p => {
        const isCritical = p.severity === 'Critical';
        const tr = document.createElement('tr');
        if (isCritical) tr.style.background = 'rgba(220, 53, 69, 0.1)';
        
        tr.innerHTML = `
            <td>#${p.id}</td>
            <td>${p.name} ${isCritical ? '🚨' : ''}</td>
            <td>${p.ward} - ${p.bed_number}</td>
            <td><span class="severity-${p.severity.toLowerCase()}">${p.severity}</span></td>
            <td>
                <button onclick="viewPatientTimeline(${p.id})" class="btn" style="padding: 5px 10px; background: var(--secondary-color); color: white;">History</button>
                <button onclick="dischargePatient(${p.id})" class="btn" style="padding: 5px 10px; background: var(--success-color); color: white;">Discharge</button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

async function dischargePatient(id) {
    if (confirm("Are you sure you want to discharge this patient? This will free up their bed.")) {
        const res = await fetch(`/api/patients/${id}/discharge`, { method: 'POST' });
        if (res.ok) {
            alert('Patient discharged successfully.');
            loadDoctorPatients();
        }
    }
}

function showEmergencyAlert(data) {
    const popup = document.getElementById('alert-popup');
    const audio = document.getElementById('alarm-sound');
    
    document.getElementById('alert-patient-name').textContent = data.patientName;
    document.getElementById('alert-message').textContent = data.message;
    
    popup.style.display = 'block';
    audio.play();

    // Log the alert to the timeline visually
    console.warn('Real-time Emergency:', data);
}

async function viewPatientTimeline(id) {
    const res = await fetch(`/api/patients/${id}`);
    const data = await res.json();
    
    let timelineHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3>Patient File: ${data.patient.name}</h3>
            <button onclick="this.closest('.modal-overlay').remove()" class="btn"><i class="fas fa-times"></i></button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="glass" style="padding: 1rem;">
                <h4>Recent Vitals</h4>
                <div id="vitals-list" style="height: 150px; overflow-y: auto;">
                    ${data.vitals.map(v => `<small>[${new Date(v.timestamp).toLocaleString()}] HR:${v.heart_rate} O2:${v.oxygen_level}%</small><br>`).join('') || 'No records'}
                </div>
            </div>
            <div class="glass" style="padding: 1rem;">
                <h4>Medical Logs</h4>
                <div style="height: 150px; overflow-y: auto;">
                    ${data.logs.map(log => `<small>[${new Date(log.timestamp).toLocaleString()}] ${log.event}</small><br>`).join('')}
                </div>
            </div>
        </div>
        <div class="glass" style="padding: 1rem; margin-top: 1rem;">
            <h4>Checkups & Findings</h4>
            <div style="height: 150px; overflow-y: auto;">
                ${data.checkups.map(c => `<div style="border-bottom: 1px solid #ddd; padding: 5px 0;"><strong>${c.findings}</strong><br><small>${c.notes} -by ${c.nurse_name || c.doctor_name}</small></div>`).join('') || 'No checkups recorded.'}
            </div>
            <hr style="margin: 1rem 0;">
            <h5>Add Checkup</h5>
            <div style="display: flex; gap: 0.5rem;">
                <input type="text" id="new-finding" placeholder="Main finding" class="glass" style="flex: 1; padding: 0.5rem;">
                <input type="text" id="new-notes" placeholder="Detailed notes" class="glass" style="flex: 2; padding: 0.5rem;">
                <button onclick="addCheckup(${id})" class="btn btn-primary">Save</button>
            </div>
        </div>
    `;
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.position = 'fixed'; overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100%'; overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)'; overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center'; overlay.style.zIndex = '10000';
    
    const div = document.createElement('div');
    div.className = 'glass';
    div.style.width = '60%';
    div.style.maxHeight = '90vh';
    div.style.overflowY = 'auto';
    div.style.padding = '2rem';
    div.innerHTML = timelineHtml;
    overlay.appendChild(div);
    document.body.appendChild(overlay);
}

async function addCheckup(patientId) {
    const findings = document.getElementById('new-finding').value;
    const notes = document.getElementById('new-notes').value;
    if (!findings) return alert('Enter findings');

    const res = await fetch('/api/checkups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, findings, notes })
    });
    if (res.ok) {
        alert('Checkup recorded!');
        document.querySelector('.modal-overlay').remove();
        viewPatientTimeline(patientId);
    }
}

async function dismissAlert() {
    const popup = document.getElementById('alert-popup');
    const audio = document.getElementById('alarm-sound');
    
    if (popup) popup.style.display = 'none';
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
    
    loadDoctorPatients();
}

// ADMIN DASHBOARD LOGIC
async function initAdminDashboard() {
    loadAdminStats();
    loadBedList();
    loadPendingAllocationList();

    // Staff Management (Add Nurse/Doctor)
    document.getElementById('add-staff-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const role = document.getElementById('s-role').value;
        const staffData = {
            name: document.getElementById('s-name').value,
            username: document.getElementById('s-username').value,
            password: document.getElementById('s-password').value,
            role: role,
            specialization: document.getElementById('s-special')?.value || ''
        };

        const endpoint = role === 'doctor' ? '/api/doctors' : '/api/auth/register-nurse'; // Nurse endpoint needs to be added
        // Actually, let's use a unified Admin endpoint
        const res = await fetch('/api/auth/admin/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(staffData)
        });

        if (res.ok) {
            alert('Staff member registered.');
            document.getElementById('add-staff-form').reset();
            loadAdminStats();
        } else {
            const err = await res.json();
            alert(err.error);
        }
    });
}

async function loadPendingAllocationList() {
    const res = await fetch('/api/patients?status=Pending');
    const patients = await res.json();
    const list = document.getElementById('pending-allocation-list');
    if (!list) return;
    list.innerHTML = '';

    if (patients.length === 0) {
        list.innerHTML = '<p style="color: var(--secondary-color);">No patients awaiting allocation.</p>';
        return;
    }

    patients.forEach(p => {
        const div = document.createElement('div');
        div.className = 'glass p-2 mb-1';
        div.style.padding = '1rem';
        div.style.marginBottom = '1rem';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${p.name}</strong> (Age: ${p.age})<br>
                    <small>Registered by: ${p.nurse_name || 'N/A'}</small>
                </div>
                <button onclick="openAllocationModal(${p.id})" class="btn btn-primary">Allocate Bed & Doctor</button>
            </div>
        `;
        list.appendChild(div);
    });
}

async function openAllocationModal(patientId) {
    const bedsRes = await fetch('/api/beds');
    const beds = await bedsRes.json();
    const availableBeds = beds.filter(b => b.status === 'Available');

    const docsRes = await fetch('/api/doctors');
    const doctors = await docsRes.json();

    if (availableBeds.length === 0) return alert('No beds available!');

    // Simple prompt-based allocation for now, can be improved to a modal
    const bedId = prompt("Enter Bed ID:\n" + availableBeds.map(b => `${b.id}: ${b.ward} - ${b.bed_number}`).join('\n'));
    if (!bedId) return;

    const docId = prompt("Enter Doctor ID:\n" + doctors.map(d => `${d.id}: Dr. ${d.name} (${d.specialization})`).join('\n'));
    if (!docId) return;

    const res = await fetch('/api/beds/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, bed_id: bedId, doctor_id: docId })
    });

    if (res.ok) {
        alert('Patient allocated successfully!');
        loadAdminStats();
        loadPendingAllocationList();
        loadBedList();
    }
}

async function loadAdminStats() {
    const resBeds = await fetch('/api/beds/stats');
    const beds = await resBeds.json();
    document.getElementById('admin-stat-occupied').textContent = beds.occupied;
    document.getElementById('admin-stat-available').textContent = beds.available;

    const resPatients = await fetch('/api/patients');
    const patients = await resPatients.json();
    document.getElementById('admin-stat-patients').textContent = patients.length;
    document.getElementById('admin-stat-critical').textContent = patients.filter(p => p.severity === 'Critical').length;
}

async function loadBedList() {
    const res = await fetch('/api/beds');
    const beds = await res.json();
    const bedList = document.getElementById('bed-list');
    bedList.innerHTML = '';
    
    beds.forEach(b => {
        const div = document.createElement('div');
        div.className = 'glass';
        div.style.padding = '10px';
        div.style.marginBottom = '5px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.innerHTML = `
            <span>${b.ward} - ${b.bed_number}</span>
            <span style="font-weight: bold; color: ${b.status === 'Available' ? 'var(--success-color)' : 'var(--danger-color)'}">${b.status}</span>
        `;
        bedList.appendChild(div);
    });
}

// SHARED HELPERS
async function loadDoctorsForSelect() {
    const res = await fetch('/api/doctors');
    const doctors = await res.json();
    const select = document.getElementById('p-doctor');
    if (!select) return;
    doctors.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `Dr. ${d.name} (${d.specialization})`;
        select.appendChild(opt);
    });
}

async function loadBedStats() {
    const res = await fetch('/api/beds/stats');
    const stats = await res.json();
    const bedStat = document.getElementById('stat-beds');
    if (bedStat) bedStat.textContent = stats.available;
}
