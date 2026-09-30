/**
 * controllers/reclamaciones.controller.js
 * ---------------------------------------------------------------
 * Gestión del libro de reclamaciones del hostal. Cada reclamo
 * registra los datos del cliente, el tipo, el detalle y la petición,
 * además de la fecha y hora automáticas del servidor.
 */
const db = require('../db');
const realtime = require('../realtime');
const { newId } = require('../utils/ids');

const TIPOS = ['reclamo', 'queja'];

function list(req, res) {
  const buscar = (req.query.buscar || '').trim().toLowerCase();
  const tipo = (req.query.tipo || '').trim();

  let sql = 'SELECT * FROM reclamaciones';
  const params = [];
  const where = [];

  if (tipo && TIPOS.includes(tipo)) {
    where.push('tipo = ?');
    params.push(tipo);
  }

  if (buscar) {
    where.push('(LOWER(nombre) LIKE ? OR LOWER(apellido) LIKE ? OR LOWER(dni) LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
  }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY fecha_reclamo DESC, hora_reclamo DESC, created_at DESC';

  const reclamaciones = db.prepare(sql).all(...params);
  res.json({ reclamaciones });
}

function create(req, res) {
  const {
    tipo,
    nombre,
    apellido,
    dni,
    telefono,
    correo,
    detalle,
    peticion,
  } = req.body || {};

  if (!tipo || !TIPOS.includes(String(tipo).trim().toLowerCase())) {
    return res.status(400).json({ error: 'Selecciona un tipo válido: reclamo o queja.' });
  }
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  }
  if (!apellido || !String(apellido).trim()) {
    return res.status(400).json({ error: 'El apellido del cliente es obligatorio.' });
  }
  if (!dni || !String(dni).trim()) {
    return res.status(400).json({ error: 'El DNI es obligatorio.' });
  }
  if (!telefono || !String(telefono).trim()) {
    return res.status(400).json({ error: 'El número de contacto es obligatorio.' });
  }
  if (!detalle || !String(detalle).trim()) {
    return res.status(400).json({ error: 'El detalle del reclamo es obligatorio.' });
  }
  if (!peticion || !String(peticion).trim()) {
    return res.status(400).json({ error: 'La petición del usuario es obligatoria.' });
  }

  const now = new Date();
  const reclamo = {
    id: newId(),
    tipo: String(tipo).trim().toLowerCase(),
    nombre: String(nombre).trim(),
    apellido: String(apellido).trim(),
    dni: String(dni).trim(),
    telefono: String(telefono).trim(),
    correo: correo ? String(correo).trim() : null,
    detalle: String(detalle).trim().slice(0, 1500),
    peticion: String(peticion).trim().slice(0, 1500),
    fecha_reclamo: now.toISOString().slice(0, 10),
    hora_reclamo: now.toTimeString().slice(0, 8),
    estado: 'pendiente',
    created_at: now.toISOString(),
  };

  db.prepare(`
    INSERT INTO reclamaciones
      (id, tipo, nombre, apellido, dni, telefono, correo, detalle, peticion, fecha_reclamo, hora_reclamo, estado, created_at)
    VALUES
      (@id, @tipo, @nombre, @apellido, @dni, @telefono, @correo, @detalle, @peticion, @fecha_reclamo, @hora_reclamo, @estado, @created_at)
  `).run(reclamo);

  realtime.broadcast('reclamaciones:changed', { id: reclamo.id, tipo: reclamo.tipo });
  res.status(201).json({ reclamo });
}

module.exports = { list, create };
