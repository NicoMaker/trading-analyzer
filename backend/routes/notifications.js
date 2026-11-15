// Notifiche dell'utente collegato (acquisti, alert, vendite forzate).
const express = require('express');
const { all, get, run } = require('../db/database');
const { wrap } = require('./helpers');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const items = await all('SELECT id, kind, severity, title, message, read, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', [req.user.id]);
  const n = await get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]);
  res.json({ items: items.map((i) => ({ ...i, read: !!i.read })), unread: n.n });
}));

router.post('/read-all', wrap(async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));

router.post('/:id/read', wrap(async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [parseInt(req.params.id, 10), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
