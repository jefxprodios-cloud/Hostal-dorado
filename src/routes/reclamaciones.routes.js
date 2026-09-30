/**
 * routes/reclamaciones.routes.js
 * ---------------------------------------------------------------
 * Rutas protegidas para el libro de reclamaciones.
 */
const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/reclamaciones.controller');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', ctrl.list);

router.post('/',
  [
    body('tipo').trim().isIn(['reclamo', 'queja']).withMessage('Tipo inválido.'),
    body('nombre').trim().notEmpty().withMessage('Nombre obligatorio.'),
    body('apellido').trim().notEmpty().withMessage('Apellido obligatorio.'),
    body('dni').trim().notEmpty().withMessage('DNI obligatorio.'),
    body('telefono').trim().notEmpty().withMessage('Teléfono obligatorio.'),
    body('detalle').trim().notEmpty().withMessage('Detalle obligatorio.'),
    body('peticion').trim().notEmpty().withMessage('Petición obligatoria.'),
  ],
  validate,
  ctrl.create
);

module.exports = router;
