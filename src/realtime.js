'use strict';
// Socket.IO: clientes conectados en tiempo real
const { Server } = require('socket.io');
const { origenPermitido } = require('./config');
const { txContexto, setEmisor } = require('./db');
const { usuarioDesdeToken } = require('./auth');

let io = null;

// Clientes conectados por Socket.IO (realtime). Solo usuarios con sesión válida:
// los eventos incluyen datos de clientes (nombre, teléfono).
function iniciarRealtime(server) {
  io = new Server(server, {
    cors: { origin: (origin, cb) => cb(null, origenPermitido(origin)) }
  });
  io.use(async (socket, next) => {
    try {
      const usuario = await usuarioDesdeToken(socket.handshake.auth && socket.handshake.auth.token);
      if (usuario.cp) return next(new Error('Debe cambiar la contraseña'));
      socket.usuario = usuario;
      next();
    } catch (e) {
      next(new Error('No autorizado'));
    }
  });
  io.on('connection', socket => {
    socket.emit('realtime:connected', { at: new Date().toISOString() });
  });
  return io;
}

// Lo que hace el propio servidor cuando pasa algo (ej. facturar solo un pedido pagado). Corre después del COMMIT,
// fuera de la petición, y un error ahí nunca corta la operación que lo disparó.
const escuchas = {};
const alEvento = (evento, fn) => { (escuchas[evento] = escuchas[evento] || []).push(fn); };

function emitirYa(evento, data) {
  for (const fn of escuchas[evento] || []) {
    setImmediate(() => Promise.resolve().then(() => fn(data)).catch(e => console.error(`[${evento}]`, e.message)));
  }
  if (!io) return;
  try { io.emit(evento, data); } catch (e) {}
}
// Las transacciones emiten sus eventos pendientes después del COMMIT
setEmisor(emitirYa);

// Dentro de una transacción los eventos se encolan y se emiten recién después del COMMIT
// (si hay ROLLBACK se descartan), así los clientes nunca ven datos a medio guardar.
const emitEvento = (evento, data) => {
  const ctx = txContexto.getStore();
  if (ctx) { ctx.eventos.push([evento, data]); return; }
  emitirYa(evento, data);
};

module.exports = { iniciarRealtime, emitEvento, alEvento };
