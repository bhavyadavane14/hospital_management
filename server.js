const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { initDb } = require('./src/models/database');

// Initialize Database
initDb();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'medimonitor-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Staff Authentication Guard for Agent Control Panel (Server-Side Protection)
app.get(['/agent.html', '/agent'], (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(__dirname, 'public', 'agent.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Socket.io connection logic
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`Socket ${socket.id} joined room ${room}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Pass io to routes
app.set('io', io);

// Routes
const authRoutes = require('./src/routes/auth');
const patientRoutes = require('./src/routes/patients');
const doctorRoutes = require('./src/routes/doctors');
const bedRoutes = require('./src/routes/beds');
const alertRoutes = require('./src/routes/alerts');
const checkupRoutes = require('./src/routes/checkups');
const appointmentRoutes = require('./src/routes/appointments');
const { router: chatbotRoutes, trainModelFromDb } = require('./src/routes/chatbot');
const agentRoutes = require('./src/routes/agent');

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/beds', bedRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/checkups', checkupRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/followups', checkupRoutes);
app.use('/api/resources', (req, res) => {
    const { db } = require('./src/models/database');
    try {
        const resources = db.prepare('SELECT * FROM hospital_resources').all();
        res.json(resources);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Train the Chatbot Model on server startup
trainModelFromDb();

// Catch-all to serve index.html for unknown routes (optional if using SPA logic)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`MediMonitor server running on http://localhost:${PORT}`);
});
