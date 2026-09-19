/**
 * server.js
 * ---------------------------------------------------------------
 * Punto de entrada de toda la aplicación. Aquí se junta todo:
 *   - Express sirve la API (/api/...) y el frontend estático (public/)
 *   - http.createServer envuelve a Express porque Socket.io necesita
 *     acceso directo al servidor HTTP para poder "escuchar" conexiones
 *     en tiempo real (WebSockets), no solo peticiones normales.
 *   - Socket.io permite que el servidor avise a todos los navegadores
 *     conectados cuando algo cambia (una habitación, una venta, etc.)
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { Server } = require('socket.io');

const config = require('./src/config');
require('./src/db'); // al importarlo, se crea/migra la base de datos y se siembra
const realtime = require('./src/realtime');

const authRoutes = require('./src/routes/auth.routes');
const roomsRoutes = require('./src/routes/rooms.routes');
const guestsRoutes = require('./src/routes/guests.routes');
const financeRoutes = require('./src/routes/finance.routes');
const inventoryRoutes = require('./src/routes/inventory.routes');
const exportRoutes = require('./src/routes/export.routes');
const reservationsRoutes = require('./src/routes/reservations.routes');
const notasRoutes = require('./src/routes/notas.routes');
const incidenciasRoutes = require('./src/routes/incidencias.routes');
const scheduleRoutes = require('./src/routes/schedule.routes');
const publicRoutes = require('./src/routes/public.routes');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
realtime.init(io);

/* ---------- Middlewares globales ---------- */
// CORS limitado a los orígenes de ambos frontales (config.corsOrigins).
// En dev los dos viven en el mismo servidor, así que es un origen único.
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());      // convierte el body JSON de las peticiones en req.body
app.use(morgan('dev'));       // imprime cada petición en consola: método, ruta, código y tiempo de respuesta

/* ---------- API ---------- */
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/guests', guestsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/notas', notasRoutes);
app.use('/api/incidencias', incidenciasRoutes);
app.use('/api/schedule', scheduleRoutes);
// Rutas públicas (sitio web): SIN auth, solo disponibilidad y pre-reservas.
app.use('/api/public', publicRoutes);

/* ---------- Frontends ---------- */
// Panel de gestión (requiere login con rol) — es el frontend principal en "/".
app.use(express.static(path.join(__dirname, 'public')));
// Sitio público de clientes (referencia visual tipo Trivago) — se sirve en /sitio.
app.use('/sitio', express.static(path.join(__dirname, 'public-site')));

// Cualquier ruta que no sea /api/... devuelve el HTML del frontend correspondiente
// (así el navegador siempre carga la aplicación, sin errores 404).
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
  if (req.path.startsWith('/sitio')) {
    return res.sendFile(path.join(__dirname, 'public-site', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- Manejo de errores (siempre al final) ---------- */
app.use(errorHandler);

/* ---------- Socket.io: solo necesitamos saber cuándo alguien se conecta ---------- */
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado en tiempo real:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Cliente desconectado:', socket.id));
});

server.listen(config.port, () => {
  console.log(`\n🏨  Hostal Dorado — servidor corriendo en http://localhost:${config.port}\n`);
});
