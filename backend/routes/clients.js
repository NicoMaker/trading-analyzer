// Clienti e allocazioni: quanti euro di un titolo sono assegnati a ciascun cliente.
const express = require("express");
const { get, all, run } = require("../db/database");
const {
  loadPortfolio,
  clientHoldings,
  clientTotals,
} = require("../services/portfolio");
const { cashOf, checkStop } = require("../services/trading");
const { notifyClient } = require("../services/notify");
const { clientSeries } = require("../services/performance");
const {
  wrap,
  bad,
  HttpError,
  reqStr,
  str,
  reqNum,
  optNum,
} = require("./helpers");

const router = express.Router();

async function ownClient(req, id) {
  const c = await get("SELECT * FROM clients WHERE id = ? AND owner_id = ?", [
    id,
    req.ownerId,
  ]);
  if (!c) throw new HttpError(404, "Cliente non trovato");
  return c;
}

const dto = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  notes: c.notes,
  capital: c.capital || 0,
  defaultStopPct: c.default_stop_pct,
  maxDrawdownPct: c.max_drawdown_pct,
});

// Elenco clienti con capitale, liquidita', investito e valore attuale
router.get(
  "/",
  wrap(async (req, res) => {
    const [clients, allocs, pf] = await Promise.all([
      all(
        "SELECT * FROM clients WHERE owner_id = ? ORDER BY name COLLATE NOCASE",
        [req.ownerId],
      ),
      all("SELECT * FROM allocations WHERE owner_id = ?", [req.ownerId]),
      loadPortfolio(req.ownerId),
    ]);
    const holdings = clientHoldings(allocs, pf.positions);
    res.json(
      clients.map((c) => {
        const h = holdings.filter((x) => x.clientId === c.id);
        const t = clientTotals(c, h);
        return {
          ...dto(c),
          positions: t.openCount,
          invested: t.invested,
          value: t.value,
          pnl: t.pnl,
          pnlPct: t.pnlPct,
          cash: t.cash,
          equity: t.equity,
          realized: t.realized,
          alerts: h.reduce((s, x) => s + x.alerts.length, 0),
        };
      }),
    );
  }),
);

// Capitale e soglie di rischio del cliente
function parseClient(b) {
  return {
    name: reqStr(b.name, "Nome cliente", 100),
    email: str(b.email, 120),
    notes: str(b.notes, 1000),
    capital: optNum(b.capital, "Capitale EUR", { min: 0 }) ?? 0,
    default_stop_pct: checkStop(b.defaultStopPct),
    max_drawdown_pct: checkStop(b.maxDrawdownPct),
  };
}

router.post(
  "/",
  wrap(async (req, res) => {
    const c = parseClient(req.body || {});
    const r = await run(
      "INSERT INTO clients (owner_id, name, email, notes, capital, default_stop_pct, max_drawdown_pct) VALUES (?,?,?,?,?,?,?)",
      [
        req.ownerId,
        c.name,
        c.email,
        c.notes,
        c.capital,
        c.default_stop_pct,
        c.max_drawdown_pct,
      ],
    );
    res.status(201).json({ id: r.lastID });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const c = await ownClient(req, parseInt(req.params.id, 10));
    const [allocs, pf] = await Promise.all([
      all(
        "SELECT * FROM allocations WHERE owner_id = ? AND client_id = ? ORDER BY (status = 'open') DESC, created_at DESC, id DESC",
        [req.ownerId, c.id],
      ),
      loadPortfolio(req.ownerId),
    ]);
    const holdings = clientHoldings(allocs, pf.positions);
    res.json({ client: dto(c), holdings, totals: clientTotals(c, holdings) });
  }),
);

// Andamento nel tempo del cliente (valore delle allocazioni contro importo investito)
router.get(
  "/:id/performance",
  wrap(async (req, res) => {
    const c = await ownClient(req, parseInt(req.params.id, 10));
    res.json(
      await clientSeries(
        c.id,
        req.ownerId,
        Math.min(365, parseInt(req.query.days, 10) || 180),
      ),
    );
  }),
);

router.put(
  "/:id",
  wrap(async (req, res) => {
    const c = await ownClient(req, parseInt(req.params.id, 10));
    const n = parseClient(req.body || {});
    await run(
      "UPDATE clients SET name=?, email=?, notes=?, capital=?, default_stop_pct=?, max_drawdown_pct=? WHERE id=?",
      [
        n.name,
        n.email,
        n.notes,
        n.capital,
        n.default_stop_pct,
        n.max_drawdown_pct,
        c.id,
      ],
    );
    res.json({ ok: true });
  }),
);

router.delete(
  "/:id",
  wrap(async (req, res) => {
    const c = await ownClient(req, parseInt(req.params.id, 10));
    await run("DELETE FROM clients WHERE id = ?", [c.id]); // le allocazioni cadono in cascata
    res.json({ ok: true });
  }),
);

// ---- Allocazioni --------------------------------------------------------------------------------
// Riepilogo per titolo: quanto e' assegnato e quanto resta (rispetto al costo della posizione)
router.get(
  "/allocations/summary",
  wrap(async (req, res) => {
    const pf = await loadPortfolio(req.ownerId);
    res.json(
      pf.positions
        .filter((p) => p.quantity > 0)
        .map((p) => ({
          isin: p.isin,
          name: p.name,
          cost: p.cost,
          value: p.value,
          allocated: p.allocatedEur,
          free: p.cost - p.allocatedEur,
          over: p.allocatedEur > p.cost + 0.01,
        })),
    );
  }),
);

router.post(
  "/:id/allocations",
  wrap(async (req, res) => {
    const c = await ownClient(req, parseInt(req.params.id, 10));
    const b = req.body || {};
    const isin = reqStr(b.isin, "Titolo", 30).toUpperCase();
    const euro = reqNum(b.euro, "Importo EUR", { gt: 0 });
    const pos = await get(
      "SELECT * FROM positions WHERE owner_id = ? AND isin = ?",
      [req.ownerId, isin],
    );
    if (!pos) throw bad("Titolo non presente nel portafoglio");
    // Capitale: il cliente non puo' investire piu' di quanto ha a disposizione
    if (!(c.capital > 0))
      throw bad(`Imposta prima il capitale di ${c.name} (Modifica cliente)`);
    const cash = cashOf(
      c,
      await all("SELECT * FROM allocations WHERE client_id = ?", [c.id]),
    );
    if (euro > cash + 0.005)
      throw bad(
        `Capitale insufficiente: ${c.name} puo' investire ancora ${Math.max(0, cash).toFixed(2)} EUR, richiesti ${euro.toFixed(2)} EUR`,
      );
    let entry = optNum(b.entryPriceEur, "Prezzo di ingresso EUR", { gt: 0 });
    if (entry == null) {
      // Prezzo attuale in EUR come prezzo di ingresso, se disponibile
      const pf = await loadPortfolio(req.ownerId);
      const p = pf.positions.find((x) => x.isin === isin);
      if (p && p.price != null && p.fx != null) entry = p.price * p.fx;
      else if (p && p.avgPrice != null) entry = p.avgPrice;
    }
    const stop =
      b.stopLossPct === "" || b.stopLossPct == null
        ? c.default_stop_pct
        : checkStop(b.stopLossPct);
    const r = await run(
      "INSERT INTO allocations (owner_id, client_id, isin, euro, entry_price_eur, note, stop_loss_pct) VALUES (?,?,?,?,?,?,?)",
      [req.ownerId, c.id, isin, euro, entry, str(b.note, 300), stop],
    );
    await notifyClient(c.id, {
      kind: "allocation",
      severity: "success",
      title: `Nuova assegnazione: ${pos.name}`,
      message: `Assegnati ${euro.toFixed(2)} EUR su ${pos.name}.${stop ? ` Stop loss al -${stop}%.` : ""}`,
    });
    res.status(201).json({ id: r.lastID, entryPriceEur: entry });
  }),
);

router.put(
  "/allocations/:aid",
  wrap(async (req, res) => {
    const a = await get(
      "SELECT * FROM allocations WHERE id = ? AND owner_id = ?",
      [parseInt(req.params.aid, 10), req.ownerId],
    );
    if (!a) throw new HttpError(404, "Allocazione non trovata");
    if (a.status === "closed")
      throw bad("Allocazione gia venduta: non modificabile");
    const b = req.body || {};
    const euro = reqNum(b.euro, "Importo EUR", { gt: 0 });
    const entry =
      optNum(b.entryPriceEur, "Prezzo di ingresso EUR", { gt: 0 }) ??
      a.entry_price_eur;
    const stop =
      b.stopLossPct === undefined ? a.stop_loss_pct : checkStop(b.stopLossPct);
    if (euro > a.euro) {
      const c = await get("SELECT * FROM clients WHERE id = ?", [a.client_id]);
      const cash = cashOf(
        c,
        await all("SELECT * FROM allocations WHERE client_id = ?", [c.id]),
      );
      if (euro - a.euro > cash + 0.005)
        throw bad(
          `Capitale insufficiente: disponibili ancora ${Math.max(0, cash).toFixed(2)} EUR`,
        );
    }
    await run(
      "UPDATE allocations SET euro=?, entry_price_eur=?, note=?, stop_loss_pct=? WHERE id=?",
      [euro, entry, str(b.note, 300), stop, a.id],
    );
    res.json({ ok: true });
  }),
);

router.delete(
  "/allocations/:aid",
  wrap(async (req, res) => {
    const r = await run(
      "DELETE FROM allocations WHERE id = ? AND owner_id = ?",
      [parseInt(req.params.aid, 10), req.ownerId],
    );
    if (!r.changes) throw new HttpError(404, "Allocazione non trovata");
    res.json({ ok: true });
  }),
);

module.exports = router;
