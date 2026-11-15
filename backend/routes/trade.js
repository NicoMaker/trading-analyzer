// Acquisti e vendite a prezzo di mercato. L'admin opera sul portafoglio di un altro utente con ?owner=ID (resolveOwner).
const express = require('express');
const trading = require('../services/trading');
const { wrap, bad } = require('./helpers');

const router = express.Router();

// Compra un titolo al prezzo attuale; se indichi un cliente l'importo e' assegnato a lui e controllato sul suo capitale
router.post('/buy', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await trading.buy({
    ownerId: req.ownerId, actorId: req.user.id, symbol: b.symbol, euro: b.euro,
    clientId: b.clientId || null, stopLossPct: b.stopLossPct, note: b.note ? String(b.note).slice(0, 300) : null,
  });
  res.status(201).json(r);
}));

// Vende quote del portafoglio non assegnate ai clienti
router.post('/sell', wrap(async (req, res) => {
  const b = req.body || {};
  if (!parseInt(b.positionId, 10)) throw bad('Titolo mancante');
  res.json(await trading.sellPosition({ ownerId: req.ownerId, positionId: parseInt(b.positionId, 10), quantity: b.quantity, all: !!b.all }));
}));

// Vende l'allocazione di un cliente al prezzo attuale e restituisce l'incasso alla sua liquidita'
router.post('/close/:allocationId', wrap(async (req, res) => {
  res.json(await trading.closeAllocation(parseInt(req.params.allocationId, 10), { reason: 'manuale', ownerId: req.ownerId }));
}));

module.exports = router;
