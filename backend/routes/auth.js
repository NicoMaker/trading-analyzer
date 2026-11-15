const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db/database');
const { requireAuth, setSession, clearSession } = require('../middleware/auth');
const realtime = require('../realtime');
const { wrap, bad, HttpError, checkPassword, checkUsername } = require('./helpers');

const router = express.Router();

// Limite tentativi di login: 5 errori per utente+IP => blocco di 1 minuto.
const attempts = new Map();
const MAX = 5, LOCK_MS = 60 * 1000;
function checkLimit(key) {
  const a = attempts.get(key);
  if (a && a.count >= MAX && Date.now() - a.last < LOCK_MS) {
    throw new HttpError(429, `Troppi tentativi. Riprova tra ${Math.ceil((LOCK_MS - (Date.now() - a.last)) / 1000)} secondi.`);
  }
}
function fail(key) {
  const a = attempts.get(key);
  const fresh = !a || Date.now() - a.last >= LOCK_MS;
  attempts.set(key, { count: fresh ? 1 : a.count + 1, last: Date.now() });
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, clientId: u.client_id, mustChangePassword: !!u.must_change_password });

router.post('/login', wrap(async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!username || !password) throw bad('Inserisci utente e password');
  const key = `${username.toLowerCase()}|${req.ip}`;
  checkLimit(key);
  const u = await get('SELECT * FROM users WHERE username = ?', [username]);
  // Si confronta sempre un hash, anche se l'utente non esiste, per non rivelare quali utenti esistono.
  const ok = await bcrypt.compare(password, u ? u.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!u || !ok || !u.active) {
    fail(key);
    throw new HttpError(401, 'Credenziali non valide');
  }
  attempts.delete(key);
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));

router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Cambio password e nome utente del proprio account: richiedono la password attuale e
// terminano TUTTE le sessioni aperte (questa e quelle su altri dispositivi): serve un nuovo login.
router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  checkPassword(next);
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw new HttpError(401, 'Password attuale errata');
  if (next === current) throw bad('La nuova password deve essere diversa');
  await run('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(next, 10), u.id]);
  clearSession(res);
  realtime.kickUser(u.id, 'Password cambiata: accedi di nuovo.');
  res.json({ ok: true, relogin: true });
}));

router.post('/change-username', requireAuth, wrap(async (req, res) => {
  const { current, username } = req.body || {};
  const name = checkUsername(username);
  const u = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw new HttpError(401, 'Password attuale errata');
  if (name.toLowerCase() === u.username.toLowerCase() && name === u.username) throw bad('Il nome utente e\' uguale a quello attuale');
  const taken = await get('SELECT id FROM users WHERE username = ? AND id <> ?', [name, u.id]);
  if (taken) throw new HttpError(409, 'Nome utente gia in uso');
  await run('UPDATE users SET username = ?, token_version = token_version + 1 WHERE id = ?', [name, u.id]);
  clearSession(res);
  realtime.kickUser(u.id, 'Nome utente cambiato: accedi di nuovo.');
  res.json({ ok: true, relogin: true });
}));

module.exports = router;
