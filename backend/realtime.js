// Tempo reale con socket.io:
//  - 'portfolio:update'  quotazioni aggiornate (il client ricarica la vista)
//  - 'data:changed'      qualcuno ha modificato dati del portafoglio (operazioni, clienti, acquisti...)
//  - 'notification'      nuova notifica per l'utente (acquisto cliente, alert, vendita forzata)
//  - 'session:kicked'    credenziali cambiate / account disattivato o eliminato: il client torna al login subito
// Stanze: user:<id>  owner:<id> (portafoglio dello staff)  cowner:<id> (clienti di quel portafoglio)
const { Server } = require("socket.io");
const { COOKIE, userFromToken } = require("./middleware/auth");
const { get } = require("./db/database");

let io = null;

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function attach(server) {
  io = new Server(server, { serveClient: true });

  io.use(async (socket, next) => {
    const user = await userFromToken(
      readCookie(socket.handshake.headers.cookie, COOKIE),
    );
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", async (socket) => {
    const u = socket.data.user;
    socket.join(`user:${u.id}`);
    if (u.role === "cliente") {
      const c = u.client_id
        ? await get("SELECT owner_id FROM clients WHERE id = ?", [
            u.client_id,
          ]).catch(() => null)
        : null;
      if (c) socket.join(`cowner:${c.owner_id}`);
    } else {
      socket.join(`owner:${u.id}`);
    }
    // L'admin che apre il portafoglio di un altro utente ne segue gli aggiornamenti in diretta
    socket.on("watch", async (ownerId) => {
      if (u.role !== "admin") return;
      for (const r of socket.rooms)
        if (r.startsWith("owner:") && r !== `owner:${u.id}`) socket.leave(r);
      const id = parseInt(ownerId, 10);
      if (id && id !== u.id) socket.join(`owner:${id}`);
    });
  });
  return io;
}

const to = (room, evt, payload) => {
  if (io) io.to(room).emit(evt, payload);
};
const toUser = (id, evt, payload) => to(`user:${id}`, evt, payload);
function toOwner(ownerId, evt, payload) {
  to(`owner:${ownerId}`, evt, payload);
  to(`cowner:${ownerId}`, evt, payload);
}

// Esce subito da tutte le sessioni aperte di un utente (anche su altri dispositivi).
function kickUser(
  userId,
  message = "Credenziali modificate: accedi di nuovo.",
) {
  if (!io) return;
  const room = `user:${userId}`;
  io.to(room).emit("session:kicked", message);
  setTimeout(() => io && io.in(room).disconnectSockets(true), 400);
}

module.exports = { attach, toUser, toOwner, kickUser };
