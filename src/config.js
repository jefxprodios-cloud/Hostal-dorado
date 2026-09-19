/**
 * config.js
 * ---------------------------------------------------------------
 * Punto único donde el resto del backend lee la configuración.
 * Nunca uses `process.env.X` directamente en otros archivos:
 * así, si mañana cambias de dónde vienen las variables (por ejemplo,
 * a un gestor de secretos en un servidor real), solo tocas este archivo.
 */
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'clave-de-desarrollo-no-usar-en-produccion',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbPath: process.env.DB_PATH || './data/hostal.db',
  // Orígenes permitidos para CORS. En dev ambos frontales viven en el
  // mismo servidor (origen único), así que el default no rompe nada.
  // En producción define CORS_ORIGINS con los dominios exactos (panel y sitio público).
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
};
