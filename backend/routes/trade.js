// Acquisti e vendite a prezzo di mercato. L'admin opera sul portafoglio di un altro utente con ?owner=ID (resolveOwner).
const express = require("express");
const trading = require("../services/trading");
const { get, all } = require("../db/database");
const { wrap, bad, HttpError } = require("./helpers");

const router = express.Router();

// Compra un titolo al prezzo attuale, indicando l'importo in euro (euro) OPPURE il numero di quote (quantity).
// Se indichi un cliente l'acquisto e' assegnato a lui e controllato sul suo capitale.
router.post(
  "/buy",
  wrap(async (req, res) => {
    const b = req.body || {};
    const r = await trading.buy({
      ownerId: req.ownerId,
      actorId: req.user.id,
      symbol: b.symbol,
      euro: b.euro,
      quantity: b.quantity,
      clientId: b.clientId || null,
      stopLossPct: b.stopLossPct,
      note: b.note ? String(b.note).slice(0, 300) : null,
    });
    res.status(201).json(r);
  }),
);

// Vende quote del portafoglio non assegnate ai clienti: quantity (quote), euro (importo) oppure all (tutte le libere)
router.post(
  "/sell",
  wrap(async (req, res) => {
    const b = req.body || {};
    if (!parseInt(b.positionId, 10)) throw bad("Titolo mancante");
    res.json(
      await trading.sellPosition({
        ownerId: req.ownerId,
        positionId: parseInt(b.positionId, 10),
        quantity: b.quantity,
        euro: b.euro,
        all: !!b.all,
      }),
    );
  }),
);

// Vende l'allocazione di un cliente al prezzo attuale e restituisce l'incasso alla sua liquidita'.
// Senza body (o con all) vende tutto; con quantity (quote) o euro (importo) vende solo una parte e il resto resta al cliente.
router.post(
  "/close/:allocationId",
  wrap(async (req, res) => {
    const b = req.body || {};
    res.json(
      await trading.sellAllocation(parseInt(req.params.allocationId, 10), {
        ownerId: req.ownerId,
        quantity: b.quantity,
        euro: b.euro,
        all: !!b.all,
      }),
    );
  }),
);

// Allocazioni aperte dei clienti su un titolo (per scegliere da quale cliente vendere)
router.get(
  "/position/:positionId/allocations",
  wrap(async (req, res) => {
    const pos = await get(
      "SELECT * FROM positions WHERE id = ? AND owner_id = ?",
      [parseInt(req.params.positionId, 10), req.ownerId],
    );
    if (!pos) throw new HttpError(404, "Posizione non trovata");
    const rows = await all(
      "SELECT a.id, a.client_id, a.euro, a.entry_price_eur, a.stop_loss_pct, c.name AS client_name FROM allocations a JOIN clients c ON c.id = a.client_id WHERE a.owner_id = ? AND a.isin = ? AND a.status = 'open' ORDER BY c.name COLLATE NOCASE, a.id",
      [req.ownerId, pos.isin],
    );
    res.json(
      rows.map((a) => ({
        id: a.id,
        clientId: a.client_id,
        clientName: a.client_name,
        euro: a.euro,
        entryPriceEur: a.entry_price_eur,
        units: a.entry_price_eur > 0 ? a.euro / a.entry_price_eur : null,
        stopLossPct: a.stop_loss_pct,
      })),
    );
  }),
);

module.exports = router;
