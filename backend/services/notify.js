// Notifiche salvate nel database e inviate in diretta via socket.io.
const { all, run } = require('../db/database');
const realtime = require('../realtime');

async function notifyUser(userId, { kind, severity = 'info', title, message = '' }) {
  const r = await run('INSERT INTO notifications (user_id, kind, severity, title, message) VALUES (?,?,?,?,?)', [userId, kind, severity, title, message]);
  realtime.toUser(userId, 'notification', { id: r.lastID, kind, severity, title, message, createdAt: new Date().toISOString() });
}

// Utenti con ruolo "cliente" collegati a un cliente
const clientUserIds = async (clientId) => (await all("SELECT id FROM users WHERE role = 'cliente' AND client_id = ? AND active = 1", [clientId])).map((u) => u.id);

async function notifyClient(clientId, note) {
  for (const id of await clientUserIds(clientId)) await notifyUser(id, note);
}

module.exports = { notifyUser, notifyClient, clientUserIds };
