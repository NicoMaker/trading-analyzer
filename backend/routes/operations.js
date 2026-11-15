const express = require('express');
const { get, all, run } = require('../db/database');
const { validateOperation, computeLedger } = require('../services/portfolio');
const { wrap, bad, HttpError, str } = require('./helpers');

const router = express.Router();

function parseOp(b) {
  const o = {
    date: String(b.date || '').trim(),
    isin: String(b.isin || '').trim().toUpperCase(),
    type: b.type,
    quantity: b.quantity, price: b.price,
    fx: b.fx === '' || b.fx == null ? 1 : b.fx,
    fees: b.fees === '' || b.fees == null ? 0 : b.fees,
    note: str(b.note, 300),
  };
  const err = validateOperation(o);
  if (err) throw bad(err);
  return { ...o, quantity: Number(o.quantity), price: Number(o.price), fx: Number(o.fx), fees: Number(o.fees) };
}

// Simula il registro con la modifica richiesta: se una vendita risultasse oltre il saldo la modifica e' rifiutata.
async function assertLedgerOk(ownerId, mutate) {
  const ops = await all('SELECT * FROM operations WHERE owner_id = ?', [ownerId]);
  const next = mutate(ops);
  const { errors } = computeLedger(next);
  if (errors.length) throw bad(errors[0].error + '. Operazione non salvata.');
}

router.get('/', wrap(async (req, res) => {
  const ops = await all('SELECT * FROM operations WHERE owner_id = ? ORDER BY date DESC, id DESC', [req.ownerId]);
  const { rows } = computeLedger(ops);
  const byId = new Map(rows.map((r) => [r.id, r]));
  res.json(ops.map((o) => {
    const r = byId.get(o.id) || {};
    return {
      id: o.id, date: o.date, isin: o.isin, type: o.type, quantity: o.quantity, price: o.price, fx: o.fx, fees: o.fees, note: o.note,
      amountEur: r.amountEur ?? null, costSold: r.costSold ?? null, result: r.result ?? null, error: r.error || null,
    };
  }));
}));

router.post('/', wrap(async (req, res) => {
  const o = parseOp(req.body || {});
  if (!(await get('SELECT id FROM positions WHERE owner_id = ? AND isin = ?', [req.ownerId, o.isin]))) throw bad('ISIN non presente nel portafoglio: aggiungi prima il titolo');
  await assertLedgerOk(req.ownerId, (ops) => [...ops, { ...o, id: Number.MAX_SAFE_INTEGER }]);
  const r = await run(
    'INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)',
    [req.ownerId, o.date, o.isin, o.type, o.quantity, o.price, o.fx, o.fees, o.note]);
  res.status(201).json({ id: r.lastID });
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await get('SELECT id FROM operations WHERE id = ? AND owner_id = ?', [id, req.ownerId]))) throw new HttpError(404, 'Operazione non trovata');
  const o = parseOp(req.body || {});
  if (!(await get('SELECT id FROM positions WHERE owner_id = ? AND isin = ?', [req.ownerId, o.isin]))) throw bad('ISIN non presente nel portafoglio');
  await assertLedgerOk(req.ownerId, (ops) => ops.map((x) => (x.id === id ? { ...o, id } : x)));
  await run('UPDATE operations SET date=?, isin=?, type=?, quantity=?, price=?, fx=?, fees=?, note=? WHERE id=? AND owner_id=?',
    [o.date, o.isin, o.type, o.quantity, o.price, o.fx, o.fees, o.note, id, req.ownerId]);
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!(await get('SELECT id FROM operations WHERE id = ? AND owner_id = ?', [id, req.ownerId]))) throw new HttpError(404, 'Operazione non trovata');
  await assertLedgerOk(req.ownerId, (ops) => ops.filter((x) => x.id !== id));
  await run('DELETE FROM operations WHERE id = ? AND owner_id = ?', [id, req.ownerId]);
  res.json({ ok: true });
}));

module.exports = router;
