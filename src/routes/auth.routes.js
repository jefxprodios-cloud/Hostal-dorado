const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const router = express.Router();

/**
 * Limitar intentos de login es una práctica básica de seguridad:
 * sin esto, cualquiera podría probar miles de contraseñas por
 * segundo contra tu servidor ("fuerza bruta"). Aquí permitimos
 * 10 intentos cada 15 minutos por dirección IP.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('El usuario es obligatorio.'),
    body('password').notEmpty().withMessage('La contraseña es obligatoria.'),
    body('role').isIn(['admin', 'recepcion']).withMessage('Rol inválido.'),
  ],
  validate,
  ctrl.login
);

router.get('/me', requireAuth, ctrl.me);

module.exports = router;
