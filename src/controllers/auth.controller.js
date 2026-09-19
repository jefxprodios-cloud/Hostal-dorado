const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');

/**
 * POST /api/auth/login
 * body: { username, password, role }
 *
 * Por qué pedimos el rol en el login además del usuario:
 * en este sistema el mismo formulario de acceso se usa para dos
 * perfiles distintos (admin / recepción). Pedir el rol evita que
 * alguien intente "adivinar" con qué permiso entra un usuario válido.
 */
function login(req, res) {
  const { username, password, role } = req.body;

  const user = db.prepare(
    `SELECT * FROM users WHERE username = ? AND role = ? AND activo = 1`
  ).get(username, role);

  // Importante: si el usuario no existe, respondemos EXACTAMENTE el
  // mismo mensaje que si la contraseña fuera incorrecta. Si diéramos
  // mensajes distintos ("usuario no existe" vs "contraseña incorrecta")
  // estaríamos regalando información a quien intenta adivinar cuentas.
  const genericError = 'Usuario, rol o contraseña incorrectos.';
  if (!user) return res.status(401).json({ error: genericError });

  const passwordOk = bcrypt.compareSync(password, user.password_hash);
  if (!passwordOk) return res.status(401).json({ error: genericError });

  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, nombre: user.nombre },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, nombre: user.nombre },
  });
}

/** GET /api/auth/me — confirma quién es el usuario del token actual. */
function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, me };
