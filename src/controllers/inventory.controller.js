const db = require('../db');
const { newId } = require('../utils/ids');
const realtime = require('../realtime');

const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function list(req, res) {
  const rows = db.prepare('SELECT * FROM inventory ORDER BY nombre ASC').all();
  res.json({ inventory: rows });
}

function create(req, res) {
  const { nombre, categoria, stock, stock_minimo, precio } = req.body;
  const row = {
    id: newId(), nombre, categoria: categoria || null,
    stock: parseInt(stock, 10) || 0, stock_minimo: parseInt(stock_minimo, 10) || 0,
    precio: Number(precio), created_at: nowISO(),
  };
  db.prepare(`
    INSERT INTO inventory (id, nombre, categoria, stock, stock_minimo, precio, created_at)
    VALUES (@id, @nombre, @categoria, @stock, @stock_minimo, @precio, @created_at)
  `).run(row);

  realtime.broadcast('inventory:changed', { reason: 'create' });
  res.status(201).json({ product: row });
}

function update(req, res) {
  const product = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const nombre = req.body.nombre ?? product.nombre;
  const categoria = req.body.categoria ?? product.categoria;
  const stock_minimo = req.body.stock_minimo != null ? parseInt(req.body.stock_minimo, 10) : product.stock_minimo;
  const precio = req.body.precio != null ? Number(req.body.precio) : product.precio;

  db.prepare('UPDATE inventory SET nombre=?, categoria=?, stock_minimo=?, precio=? WHERE id=?')
    .run(nombre, categoria, stock_minimo, precio, product.id);

  realtime.broadcast('inventory:changed', { reason: 'update' });
  res.json({ product: { ...product, nombre, categoria, stock_minimo, precio } });
}

function remove(req, res) {
  const product = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  db.prepare('DELETE FROM inventory WHERE id = ?').run(product.id);
  realtime.broadcast('inventory:changed', { reason: 'delete' });
  res.json({ ok: true });
}

/**
 * POST /api/inventory/:id/sell
 * El corazón de "cada vez que se registre un producto vendido el
 * stock disminuya": se ejecuta dentro de una transacción para que,
 * si algo falla a mitad de camino, NO quede el stock descontado sin
 * su ingreso correspondiente en finanzas (o viceversa).
 */
function sell(req, res) {
  const product = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const cantidad = parseInt(req.body.cantidad, 10);
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: 'Cantidad inválida.' });
  if (cantidad > product.stock) {
    return res.status(409).json({ error: `Stock insuficiente: solo quedan ${product.stock} unidad(es) de ${product.nombre}.` });
  }

  const monto = cantidad * product.precio;
  const db_ = require('../db');

  const runSale = db_.transaction(() => {
    db_.prepare('UPDATE inventory SET stock = stock - ? WHERE id = ?').run(cantidad, product.id);

    db_.prepare(`
      INSERT INTO inventory_movements (id, producto_id, tipo, cantidad, motivo, created_by, created_at)
      VALUES (?, ?, 'venta', ?, ?, ?, ?)
    `).run(newId(), product.id, cantidad, 'Venta a huésped', req.user.sub, nowISO());

    const financeRow = {
      id: newId(), fecha: today(), concepto: `Venta: ${product.nombre} x${cantidad}`,
      tipo: 'ingreso', monto, metodo: req.body.metodo || 'Efectivo',
      referencia_estancia_id: null, created_by: req.user.sub, created_at: nowISO(),
    };
    db_.prepare(`
      INSERT INTO finance (id, fecha, concepto, tipo, monto, metodo, referencia_estancia_id, created_by, created_at)
      VALUES (@id, @fecha, @concepto, @tipo, @monto, @metodo, @referencia_estancia_id, @created_by, @created_at)
    `).run(financeRow);
  });

  runSale();

  realtime.broadcast('inventory:changed', { reason: 'sale' });
  realtime.broadcast('finance:changed', { reason: 'sale' });
  res.json({ ok: true, nuevoStock: product.stock - cantidad, monto });
}

/** POST /api/inventory/:id/adjust — corrección manual de stock (solo admin), queda en la auditoría. */
function adjust(req, res) {
  const product = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });

  const delta = parseInt(req.body.delta, 10); // puede ser negativo o positivo
  const motivo = req.body.motivo || 'Ajuste manual';
  if (!delta) return res.status(400).json({ error: 'Indica cuánto ajustar (positivo o negativo).' });
  if (product.stock + delta < 0) return res.status(409).json({ error: 'El ajuste dejaría el stock en negativo.' });

  db.prepare('UPDATE inventory SET stock = stock + ? WHERE id = ?').run(delta, product.id);
  db.prepare(`
    INSERT INTO inventory_movements (id, producto_id, tipo, cantidad, motivo, created_by, created_at)
    VALUES (?, ?, 'ajuste', ?, ?, ?, ?)
  `).run(newId(), product.id, delta, motivo, req.user.sub, nowISO());

  realtime.broadcast('inventory:changed', { reason: 'adjust' });
  res.json({ ok: true, nuevoStock: product.stock + delta });
}

module.exports = { list, create, update, remove, sell, adjust };
