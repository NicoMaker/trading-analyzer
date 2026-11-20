// Gestione utenti: solo admin.
const express = require("express");
const bcrypt = require("bcryptjs");
const { get, all, run } = require("../db/database");
const { requireRole, clearSession } = require("../middleware/auth");
const realtime = require("../realtime");
const {
  wrap,
  bad,
  HttpError,
  reqStr,
  checkPassword,
  checkUsername,
} = require("./helpers");

const router = express.Router();
router.use(requireRole("admin"));

const ROLES = ["admin", "utente", "cliente"];

const toDto = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  active: !!u.active,
  protected: !!u.protected,
  clientId: u.client_id,
  clientName: u.client_name || null,
  createdAt: u.created_at,
  mustChangePassword: !!u.must_change_password,
});

router.get(
  "/",
  wrap(async (req, res) => {
    const rows = await all(
      `SELECT u.*, c.name AS client_name FROM users u LEFT JOIN clients c ON c.id = u.client_id ORDER BY u.role, u.username`,
    );
    res.json(rows.map(toDto));
  }),
);

// Elenco dei portafogli selezionabili dall'admin
router.get(
  "/owners",
  wrap(async (req, res) => {
    const rows = await all(
      "SELECT id, username, name, role FROM users WHERE role IN ('admin','utente') AND active = 1 ORDER BY name COLLATE NOCASE",
    );
    res.json(rows);
  }),
);

async function checkClientLink(role, clientId) {
  if (role !== "cliente") return null;
  const id = parseInt(clientId, 10);
  if (!id)
    throw bad("Per il ruolo cliente scegli a quale cliente collegare l'utente");
  if (!(await get("SELECT id FROM clients WHERE id = ?", [id])))
    throw bad("Cliente non trovato");
  return id;
}

async function otherActiveAdmins(excludeId) {
  const n = await get(
    "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id <> ?",
    [excludeId],
  );
  return n.n;
}

router.post(
  "/",
  wrap(async (req, res) => {
    const b = req.body || {};
    const username = checkUsername(b.username);
    const name = reqStr(b.name, "Nome", 100);
    if (!ROLES.includes(b.role)) throw bad("Ruolo non valido");
    checkPassword(b.password);
    const clientId = await checkClientLink(b.role, b.clientId);
    const r = await run(
      "INSERT INTO users (username, name, password_hash, role, client_id, must_change_password) VALUES (?,?,?,?,?,1)",
      [username, name, await bcrypt.hash(b.password, 10), b.role, clientId],
    );
    res.status(201).json({ id: r.lastID });
  }),
);

router.put(
  "/:id",
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const u = await get("SELECT * FROM users WHERE id = ?", [id]);
    if (!u) throw new HttpError(404, "Utente non trovato");
    const b = req.body || {};
    const name = b.name !== undefined ? reqStr(b.name, "Nome", 100) : u.name;
    const username =
      b.username !== undefined ? checkUsername(b.username) : u.username;
    const role = b.role !== undefined ? b.role : u.role;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
    if (!ROLES.includes(role)) throw bad("Ruolo non valido");
    const clientId =
      role === "cliente"
        ? await checkClientLink(
            role,
            b.clientId !== undefined ? b.clientId : u.client_id,
          )
        : null;

    if (
      u.role === "admin" &&
      (role !== "admin" || !active) &&
      (await otherActiveAdmins(id)) === 0
    )
      throw bad("Deve restare almeno un amministratore attivo");

    const usernameChanged = username !== u.username;
    if (
      usernameChanged &&
      (await get("SELECT id FROM users WHERE username = ? AND id <> ?", [
        username,
        id,
      ]))
    )
      throw new HttpError(409, "Nome utente gia in uso");
    let passwordChanged = false;
    if (b.password) {
      checkPassword(b.password);
      passwordChanged = true;
    }

    await run(
      "UPDATE users SET name=?, username=?, role=?, active=?, client_id=? WHERE id=?",
      [name, username, role, active, clientId, id],
    );
    if (passwordChanged) {
      await run(
        "UPDATE users SET password_hash=?, must_change_password=?, token_version = token_version + 1 WHERE id=?",
        [await bcrypt.hash(b.password, 10), id === req.user.id ? 0 : 1, id],
      );
    } else if (usernameChanged) {
      await run(
        "UPDATE users SET token_version = token_version + 1 WHERE id=?",
        [id],
      );
    }
    // Se l'admin modifica le credenziali del proprio account, esce anche lui (e ogni altra sessione di quell'utente)
    const relogin =
      id === req.user.id &&
      (usernameChanged || passwordChanged || role !== u.role || !active);
    if (relogin) clearSession(res);
    // Credenziali, ruolo o stato cambiati: l'utente esce SUBITO da ogni dispositivo (socket.io), senza aspettare la prossima richiesta
    if (
      usernameChanged ||
      passwordChanged ||
      role !== u.role ||
      (u.active && !active) ||
      clientId !== u.client_id
    ) {
      if (role !== u.role || clientId !== u.client_id)
        await run(
          "UPDATE users SET token_version = token_version + 1 WHERE id=?",
          [id],
        );
      realtime.kickUser(
        id,
        passwordChanged || usernameChanged
          ? "Le tue credenziali sono state modificate: accedi di nuovo."
          : "Il tuo account e' stato modificato: accedi di nuovo.",
      );
    }
    res.json({ ok: true, relogin });
  }),
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const u = await get("SELECT * FROM users WHERE id = ?", [id]);
    if (!u) throw new HttpError(404, "Utente non trovato");
    if (u.role === "admin" && (await otherActiveAdmins(id)) === 0)
      throw bad("Deve restare almeno un amministratore attivo");
    // Un admin puo' eliminare anche il proprio account (es. quello iniziale) se resta almeno un altro admin attivo; gli altri ruoli no.
    if (id === req.user.id && u.role !== "admin")
      throw bad("Non puoi eliminare il tuo account");
    // Le posizioni, operazioni, clienti e allocazioni dell'utente vengono eliminati in cascata.
    await run("DELETE FROM users WHERE id = ?", [id]);
    realtime.kickUser(id, "Il tuo account e' stato eliminato.");
    const self = id === req.user.id;
    if (self) clearSession(res);
    res.json({ ok: true, relogin: self });
  }),
);

module.exports = router;
