const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { get } = require("../db/database");

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    return fs.readFileSync(config.SECRET_FILE, "utf8").trim();
  } catch {
    const s = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(config.SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const COOKIE = "ta_session";

function signToken(user) {
  return jwt.sign({ uid: user.id, tv: user.token_version || 0 }, SECRET, {
    expiresIn: `${config.TOKEN_TTL_HOURS}h`,
  });
}

function setSession(res, user) {
  res.cookie(COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: "strict",
    maxAge: config.TOKEN_TTL_HOURS * 3600 * 1000,
  });
}
const clearSession = (res) => res.clearCookie(COOKIE);

// Verifica un token di sessione (usato anche dalle connessioni socket.io). Restituisce l'utente o null.
async function userFromToken(token) {
  try {
    if (!token) return null;
    const payload = jwt.verify(token, SECRET);
    const user = await get(
      "SELECT id, username, name, role, client_id, active, must_change_password, protected, token_version FROM users WHERE id = ?",
      [payload.uid],
    );
    if (!user || !user.active || (payload.tv || 0) !== user.token_version)
      return null;
    return user;
  } catch {
    return null;
  }
}

// Carica l'utente dal cookie; l'utente viene riletto dal DB a ogni richiesta, quindi
// disattivazione e cambio ruolo hanno effetto immediato.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: "Accesso richiesto" });
    const payload = jwt.verify(token, SECRET);
    const user = await get(
      "SELECT id, username, name, role, client_id, active, must_change_password, protected, token_version FROM users WHERE id = ?",
      [payload.uid],
    );
    if (!user || !user.active)
      return res.status(401).json({ error: "Sessione non valida" });
    // Nome utente o password cambiati: tutte le sessioni precedenti (anche su altri dispositivi) decadono
    if ((payload.tv || 0) !== user.token_version)
      return res
        .status(401)
        .json({ error: "Credenziali modificate: rifai il login" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Sessione scaduta, rifai il login" });
  }
}

const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: "Permesso negato" });

// Determina di quale portafoglio si sta lavorando. L'admin puo' scegliere con ?owner=ID,
// gli altri lavorano sempre e solo sul proprio.
async function resolveOwner(req, res, next) {
  try {
    let owner = req.user.id;
    const asked = req.query.owner || (req.body && req.body.owner_id);
    if (asked && req.user.role === "admin") {
      const id = parseInt(asked, 10);
      const u = await get(
        "SELECT id FROM users WHERE id = ? AND role IN ('admin','utente')",
        [id],
      );
      if (!u) return res.status(404).json({ error: "Portafoglio non trovato" });
      owner = id;
    }
    req.ownerId = owner;
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = {
  COOKIE,
  userFromToken,
  requireAuth,
  requireRole,
  resolveOwner,
  setSession,
  clearSession,
};
