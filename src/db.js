/**
 * db.js
 * ---------------------------------------------------------------
 * Toda la capa de datos vive aquí. Usamos SQLite (con better-sqlite3,
 * una librería SÍNCRONA: cada consulta se ejecuta y devuelve el
 * resultado en la misma línea, sin callbacks ni promesas). Para un
 * sistema de un solo hostal esto es perfectamente "real": SQLite es
 * una base de datos de producción de verdad, usada por miles de
 * aplicaciones. El día que el negocio crezca a varias sedes con
 * mucha concurrencia, este mismo código SQL casi no cambia si migras
 * a PostgreSQL o MySQL — cambia el "driver", no tu forma de pensar
 * el problema.
 *
 * Aquí se define:
 *   1) El ESQUEMA (las tablas y sus relaciones)
 *   2) Los DATOS SEMILLA (usuarios y datos de ejemplo la primera vez)
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { newId } = require('./utils/ids');

// Asegura que la carpeta donde vive el archivo .db exista.
const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(config.dbPath));
db.pragma('journal_mode = WAL'); // mejor rendimiento con lecturas/escrituras simultáneas
db.pragma('foreign_keys = ON');  // SQLite no valida llaves foráneas si no se activa esto

/* ============================================================
   ESQUEMA
   ============================================================
   Convenciones usadas en todo el proyecto:
   - id: TEXT (UUID) en vez de un número autoincremental. Así los IDs
     nunca chocan aunque migres datos entre servidores.
   - created_at: guardamos SIEMPRE cuándo se creó cada fila, para
     poder auditar "quién hizo qué y cuándo" (típico requisito real).
   - CHECK(...): SQLite valida el dato a nivel de base de datos, no
     solo en el código — una segunda barrera de seguridad.
*/
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','recepcion')),
    nombre        TEXT NOT NULL,
    activo        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    numero      TEXT NOT NULL UNIQUE,
    tipo        TEXT NOT NULL,
    precio      REAL NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'libre'
                CHECK (estado IN ('libre','ocupado','limpieza','mantenimiento')),
    created_at  TEXT NOT NULL
  );

  -- Huéspedes: campos exigidos por el Reglamento de Establecimientos
  -- de Hospedaje del Perú para la Ficha/Libro de Registro de Huésped.
  CREATE TABLE IF NOT EXISTS guests (
    id                 TEXT PRIMARY KEY,
    tipo_documento     TEXT NOT NULL CHECK (tipo_documento IN ('DNI','Pasaporte','Carné de Extranjería')),
    numero_documento   TEXT NOT NULL,
    nombres            TEXT NOT NULL,
    apellidos          TEXT NOT NULL,
    nacionalidad       TEXT NOT NULL,
    procedencia        TEXT,
    destino            TEXT,
    telefono           TEXT,
    fecha_nacimiento   TEXT,
    created_at         TEXT NOT NULL,
    UNIQUE(tipo_documento, numero_documento)
  );

  -- Estancias: une una habitación con un huésped durante un rango de fechas.
  -- Es el corazón del "check-in / check-out".
  CREATE TABLE IF NOT EXISTS stays (
    id                TEXT PRIMARY KEY,
    room_id           TEXT NOT NULL REFERENCES rooms(id),
    guest_id          TEXT NOT NULL REFERENCES guests(id),
    checkin_date      TEXT NOT NULL,
    checkout_date     TEXT,
    nights            INTEGER NOT NULL,
    price_per_night   REAL NOT NULL,
    total             REAL,
    motivo_viaje      TEXT,
    estado            TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','finalizada')),
    created_by        TEXT NOT NULL REFERENCES users(id),
    created_at        TEXT NOT NULL
  );

  -- Finanzas: todo ingreso o egreso de dinero del hostal.
  -- referencia_estancia_id permite rastrear "de qué check-out vino este ingreso".
  CREATE TABLE IF NOT EXISTS finance (
    id                     TEXT PRIMARY KEY,
    fecha                  TEXT NOT NULL,
    concepto               TEXT NOT NULL,
    tipo                   TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
    monto                  REAL NOT NULL CHECK (monto > 0),
    metodo                 TEXT NOT NULL,
    referencia_estancia_id TEXT REFERENCES stays(id),
    created_by             TEXT NOT NULL REFERENCES users(id),
    created_at             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria     TEXT,
    stock         INTEGER NOT NULL DEFAULT 0,
    stock_minimo  INTEGER NOT NULL DEFAULT 0,
    precio        REAL NOT NULL,
    created_at    TEXT NOT NULL
  );

  -- Auditoría de cada movimiento de stock (venta o ajuste manual).
  -- Sin esta tabla, si el stock "no cuadra" un día, nadie podría saber por qué.
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id            TEXT PRIMARY KEY,
    producto_id   TEXT NOT NULL REFERENCES inventory(id),
    tipo          TEXT NOT NULL CHECK (tipo IN ('venta','ajuste')),
    cantidad      INTEGER NOT NULL,
    motivo        TEXT,
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL
  );

  -- Pre-reservas hechas desde el SITIO PÚBLICO. Nunca son un check-in:
  -- llegan como 'pendiente' y el staff las confirma o cancela desde el
  -- panel. Cada reserva ocupa un bloque de 12 horas desde la hora de
  -- ingreso elegida (hora_ingreso, 0-23). Mientras está 'pendiente'
  -- bloquea una "unidad" de su tipo; al 'confirmada' se le asigna una
  -- habitación concreta (room_id) y bloquea esa habitación por 12 h.
  CREATE TABLE IF NOT EXISTS reservations (
    id              TEXT PRIMARY KEY,
    tipo_habitacion TEXT NOT NULL,
    cantidad        INTEGER NOT NULL DEFAULT 1,
    checkin         TEXT NOT NULL,
    checkout        TEXT NOT NULL,
    hora_ingreso    INTEGER NOT NULL DEFAULT 0,
    room_id         TEXT REFERENCES rooms(id),
    nombre          TEXT NOT NULL,
    telefono        TEXT,
    email           TEXT,
    estado          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','confirmada','cancelada')),
    created_at      TEXT NOT NULL
  );

  -- Notas internas del staff (panel lateral de Resumen): avisos cortos
  -- entre administración y recepción. No son públicas ni traen estados.
  CREATE TABLE IF NOT EXISTS notas (
    id         TEXT PRIMARY KEY,
    texto      TEXT NOT NULL,
    autor      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Incidencias del hostal: control de averías/quejas registradas por
  -- el staff en el modal de acciones rápidas. Ciclo: abierta →
  -- en_revision → resuelta (y se puede reabrir). created_at es ISO
  -- completo (fecha + hora) para saber exactamente cuándo se reportó.
  CREATE TABLE IF NOT EXISTS incidencias (
    id             TEXT PRIMARY KEY,
    tipo           TEXT NOT NULL,
    ubicacion      TEXT NOT NULL,
    habitacion_num TEXT,
    detalle        TEXT,
    estado         TEXT NOT NULL DEFAULT 'abierta'
                   CHECK (estado IN ('abierta','en_revision','resuelta')),
    reportado_por  TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_stays_room   ON stays(room_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_dates ON reservations(checkin, checkout);
  CREATE INDEX IF NOT EXISTS idx_stays_guest  ON stays(guest_id);
  CREATE INDEX IF NOT EXISTS idx_finance_fecha ON finance(fecha);
  CREATE INDEX IF NOT EXISTS idx_guests_doc    ON guests(tipo_documento, numero_documento);
`);

// Migraciones para bases existentes: SQLite no permite modificar columnas
// sin recrear la tabla, así que solo añadimos columnas (idempotente).
for (const ddl of [
  `ALTER TABLE reservations ADD COLUMN hora_ingreso INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE reservations ADD COLUMN room_id TEXT REFERENCES rooms(id)`,
]) {
  try { db.prepare(ddl).run(); } catch (_) { /* columna ya existente */ }
}
db.prepare('CREATE INDEX IF NOT EXISTS idx_reservations_room ON reservations(room_id)').run();

/* ============================================================
   DATOS SEMILLA — solo se insertan si las tablas están vacías,
   así puedes borrar el archivo .db y volver a "instalar" el
   sistema en segundos.
   ============================================================ */
const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (id, username, password_hash, role, nombre, activo, created_at)
      VALUES (@id, @username, @password_hash, @role, @nombre, 1, @created_at)
    `);
    insertUser.run({
      id: newId(), username: 'admin',
      password_hash: bcrypt.hashSync('admin123', 10),
      role: 'admin', nombre: 'Administración', created_at: nowISO(),
    });
    insertUser.run({
      id: newId(), username: 'recepcion',
      password_hash: bcrypt.hashSync('recep123', 10),
      role: 'recepcion', nombre: 'Recepción', created_at: nowISO(),
    });
    console.log('✔ Usuarios semilla creados (admin/admin123, recepcion/recep123)');
  }

  const roomCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
  if (roomCount === 0) {
    const insertRoom = db.prepare(`
      INSERT INTO rooms (id, numero, tipo, precio, estado, created_at)
      VALUES (@id, @numero, @tipo, @precio, @estado, @created_at)
    `);
    const tipos = [
      { tipo: 'Individual', precio: 60 },
      { tipo: 'Matrimonial', precio: 80 },
      { tipo: 'Doble', precio: 95 },
      { tipo: 'Suite', precio: 140 },
    ];
    let count = 0;
    for (let piso = 1; piso <= 3; piso++) {
      for (let i = 0; i < 4; i++) {
        const t = tipos[i % tipos.length];
        insertRoom.run({
          id: newId(), numero: String(piso * 100 + i + 1), tipo: t.tipo,
          precio: t.precio, estado: 'libre', created_at: nowISO(),
        });
        count++;
      }
    }
    console.log(`✔ ${count} habitaciones semilla creadas`);
  }

  const invCount = db.prepare('SELECT COUNT(*) AS c FROM inventory').get().c;
  if (invCount === 0) {
    const insertProd = db.prepare(`
      INSERT INTO inventory (id, nombre, categoria, stock, stock_minimo, precio, created_at)
      VALUES (@id, @nombre, @categoria, @stock, @stock_minimo, @precio, @created_at)
    `);
    const productos = [
      { nombre: 'Agua 625ml', categoria: 'Bebidas', stock: 24, stock_minimo: 8, precio: 3.5 },
      { nombre: 'Gaseosa personal', categoria: 'Bebidas', stock: 18, stock_minimo: 6, precio: 4.5 },
      { nombre: 'Snack salado', categoria: 'Snacks', stock: 5, stock_minimo: 6, precio: 5.0 },
      { nombre: 'Kit de aseo', categoria: 'Amenities', stock: 30, stock_minimo: 10, precio: 8.0 },
      { nombre: 'Toalla extra', categoria: 'Amenities', stock: 2, stock_minimo: 5, precio: 6.0 },
    ];
    productos.forEach(p => insertProd.run({ id: newId(), created_at: nowISO(), ...p }));
    console.log('✔ Inventario semilla creado');
  }

  const financeCount = db.prepare('SELECT COUNT(*) AS c FROM finance').get().c;
  if (financeCount === 0) {
    const admin = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
    const insertFin = db.prepare(`
      INSERT INTO finance (id, fecha, concepto, tipo, monto, metodo, created_by, created_at)
      VALUES (@id, @fecha, @concepto, @tipo, @monto, @metodo, @created_by, @created_at)
    `);
    insertFin.run({ id: newId(), fecha: today(), concepto: 'Saldo inicial de caja', tipo: 'ingreso', monto: 500, metodo: 'Efectivo', created_by: admin.id, created_at: nowISO() });
    console.log('✔ Movimiento financiero semilla creado');
  }
}

seed();

module.exports = db;
