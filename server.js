// =============================================
// FADIDO - Servidor Principal
// Punto de entrada: migra la base, inicia Socket.IO y el servidor HTTP.
// El código está en src/ (app.js, rutas/, servicios/).
// =============================================

require('./src/env'); // .env de la instalación
const { server } = require('./src/app');
const { PORT } = require('./src/config');
const { ZONA_HORARIA } = require('./src/tiempo');
const { iniciarRealtime } = require('./src/realtime');
const { migrarConRespaldo } = require('./src/migraciones');
const { backupSiCorresponde, crearBackup } = require('./src/servicios/backups');
const { iniciarMonitoreo } = require('./src/servicios/monitoreo');
const { iniciarRecordatoriosWhatsApp } = require('./src/servicios/whatsapp');
const { iniciarModoSinConexion } = require('./src/servicios/sin-conexion');
const { iniciarSyncNube } = require('./src/servicios/sync-nube');
const { iniciarCierreAutomatico } = require('./src/servicios/cierre-dia');
const { iniciarFacturaAutomatica } = require('./src/servicios/facturacion-auto');
const { iniciarResumenDueno } = require('./src/servicios/resumen-dueno');
const { iniciarConciliacionTransferencias } = require('./src/servicios/transferencias-mp');

iniciarRealtime(server);

// Copia previa si hay migraciones nuevas + migraciones en una sola transacción (ver src/migraciones.js)
migrarConRespaldo({ respaldar: crearBackup }).then(() => server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  🍽️  FADIDO v2.0');
  console.log('  Sistema de Gestión Gastronómica');
  console.log('==========================================');
  console.log(`  Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`  API disponible en: http://localhost:${PORT}/api`);
  console.log(`  Socket.IO realtime: activo`);
  console.log(`  Zona horaria: ${ZONA_HORARIA}`);
  console.log('==========================================');
  // Copias de seguridad automáticas
  backupSiCorresponde();
  setInterval(backupSiCorresponde, 60 * 60 * 1000).unref();
  // Latido al servicio de monitoreo (si MONITOREO_URL está configurada)
  iniciarMonitoreo();
  // Recordatorios de reservas por WhatsApp (si está activado en Integraciones)
  iniciarRecordatoriosWhatsApp();
  // Aviso de "sin internet" y facturas en espera que se emiten solas al volver la conexión
  iniciarModoSinConexion();
  // Ventas y estado del local al panel Fadido Nube (si NUBE_URL y NUBE_TOKEN están en el .env)
  iniciarSyncNube();
  // Cierre del día a la hora configurada (si está activado en Caja → Cierre del día)
  iniciarCierreAutomatico();
  // Factura sola de cada venta pagada (si está activado en Integraciones → AFIP)
  iniciarFacturaAutomatica();
  // Resumen del día por WhatsApp al dueño al cerrar el día (si cargó su número en Integraciones → WhatsApp)
  iniciarResumenDueno();
  // Transferencias al alias que entran a Mercado Pago: cobra solo el pedido que avisó que transfirió (si MP está activo)
  iniciarConciliacionTransferencias();
})).catch(err => {
  console.error('Error al migrar la base de datos:', err);
  process.exit(1);
});
