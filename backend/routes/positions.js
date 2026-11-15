const express = require('express');
const { get, run, transaction } = require('../db/database');
const market = require('../services/market');
const { loadPortfolio } = require('../services/portfolio');
const { analyze } = require('../services/indicators');
const { portfolioSeries } = require('../services/performance');
const { wrap, bad, HttpError, optNum, str, reqStr, RISKS, CURRENCIES } = require('./helpers');

const router = express.Router();

function parsePosition(b, { creating }) {
  const out = {
    name: reqStr(b.name, 'Titolo'),
    ticker: str(b.ticker, 30) ? str(b.ticker, 30).toUpperCase() : null,
    currency: str(b.currency, 5) ? str(b.currency, 5).toUpperCase() : null,
    sector: str(b.sector, 80),
    risk: RISKS.includes(b.risk) ? b.risk : 'Da valutare',
    max_weight: optNum(b.maxWeight, 'Peso massimo %', { gt: 0, max: 100 }),
    stop_price: optNum(b.stopPrice, 'Stop', { gt: 0 }),
    target_price: optNum(b.targetPrice, 'Obiettivo', { gt: 0 }),
    min_value_eur: optNum(b.minValueEur, 'Valore minimo EUR', { min: 0 }),
    min_pl_pct: optNum(b.minPlPct, 'Soglia utile/perdita %'),
    day_drop_pct: optNum(b.dayDropPct, 'Calo giornaliero %', { gt: 0, max: 100 }),
    rsi_low: optNum(b.rsiLow, 'RSI ipervenduto', { min: 1, max: 99 }),
    rsi_high: optNum(b.rsiHigh, 'RSI ipercomprato', { min: 1, max: 99 }),
    next_review: str(b.nextReview, 10),
    dividends: optNum(b.dividends, 'Dividendi', { min: 0 }) ?? 0,
    manual_price: optNum(b.manualPrice, 'Prezzo manuale', { gt: 0 }),
    manual_fx: optNum(b.manualFx, 'Cambio manuale', { gt: 0 }),
    notes: str(b.notes, 2000),
  };
  if (out.next_review && !/^\d{4}-\d{2}-\d{2}$/.test(out.next_review)) throw bad('Prossima revisione: data non valida');
  if (out.stop_price != null && out.target_price != null && out.stop_price >= out.target_price) throw bad('Lo stop deve essere inferiore all\'obiettivo');
  if (out.rsi_low != null && out.rsi_high != null && out.rsi_low >= out.rsi_high) throw bad('RSI: la soglia bassa deve essere minore della alta');
  if (creating) {
    out.isin = reqStr(b.isin, 'ISIN', 30).toUpperCase();
  }
  return out;
}

router.get('/', wrap(async (req, res) => {
  res.json(await loadPortfolio(req.ownerId));
}));

// Valore del portafoglio nel tempo contro il costo (grafico delle rendite)
router.get('/performance', wrap(async (req, res) => {
  res.json(await portfolioSeries(req.ownerId, Math.min(365, parseInt(req.query.days, 10) || 180)));
}));

router.post('/', wrap(async (req, res) => {
  const p = parsePosition(req.body || {}, { creating: true });
  // Se manca il ticker e il codice e' un ISIN, prova a ricavarlo da Yahoo (best effort)
  if (!p.ticker && market.looksLikeIsin(p.isin)) {
    try { const f = await market.resolveIsin(p.isin); if (f) { p.ticker = f.symbol; p.sector = p.sector || f.sector; } } catch { /* offline: resta senza ticker */ }
  }
  if (p.ticker && !p.currency) {
    try { const d = await market.getSymbolData(p.ticker); p.currency = d.currency; } catch { /* verra' segnalato come quotazione mancante */ }
  }
  p.currency = p.currency || 'EUR';
  const r = await run(
    `INSERT INTO positions (owner_id, isin, name, ticker, currency, sector, risk, max_weight, stop_price, target_price, min_value_eur,
       min_pl_pct, day_drop_pct, rsi_low, rsi_high, next_review, dividends, manual_price, manual_fx, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.ownerId, p.isin, p.name, p.ticker, p.currency, p.sector, p.risk, p.max_weight, p.stop_price, p.target_price, p.min_value_eur,
      p.min_pl_pct, p.day_drop_pct, p.rsi_low, p.rsi_high, p.next_review, p.dividends, p.manual_price, p.manual_fx, p.notes]);
  res.status(201).json({ id: r.lastID });
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await get('SELECT * FROM positions WHERE id = ? AND owner_id = ?', [id, req.ownerId]);
  if (!cur) throw new HttpError(404, 'Posizione non trovata');
  const p = parsePosition(req.body || {}, { creating: false });
  p.currency = p.currency || cur.currency;
  await run(
    `UPDATE positions SET name=?, ticker=?, currency=?, sector=?, risk=?, max_weight=?, stop_price=?, target_price=?, min_value_eur=?,
       min_pl_pct=?, day_drop_pct=?, rsi_low=?, rsi_high=?, next_review=?, dividends=?, manual_price=?, manual_fx=?, notes=?
     WHERE id=? AND owner_id=?`,
    [p.name, p.ticker, p.currency, p.sector, p.risk, p.max_weight, p.stop_price, p.target_price, p.min_value_eur,
      p.min_pl_pct, p.day_drop_pct, p.rsi_low, p.rsi_high, p.next_review, p.dividends, p.manual_price, p.manual_fx, p.notes, id, req.ownerId]);
  res.json({ ok: true });
}));

// Elimina la posizione con le sue operazioni e allocazioni
router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await get('SELECT * FROM positions WHERE id = ? AND owner_id = ?', [id, req.ownerId]);
  if (!cur) throw new HttpError(404, 'Posizione non trovata');
  await transaction(async (tx) => {
    await tx.run('DELETE FROM operations WHERE owner_id = ? AND isin = ?', [req.ownerId, cur.isin]);
    await tx.run('DELETE FROM allocations WHERE owner_id = ? AND isin = ?', [req.ownerId, cur.isin]);
    await tx.run('DELETE FROM alert_log WHERE owner_id = ? AND isin = ?', [req.ownerId, cur.isin]);
    await tx.run('DELETE FROM positions WHERE id = ?', [id]);
  });
  res.json({ ok: true });
}));

// Analisi tecnica completa di un titolo: indicatori, segnali e serie per il grafico
router.get('/:id/analysis', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await get('SELECT * FROM positions WHERE id = ? AND owner_id = ?', [id, req.ownerId]);
  if (!cur) throw new HttpError(404, 'Posizione non trovata');
  if (!cur.ticker) throw bad('Imposta il ticker per vedere l\'analisi');
  const d = await market.getSymbolData(cur.ticker, { force: req.query.force === '1' });
  const a = analyze(d.candles);
  res.json({
    symbol: d.symbol, name: d.name, exchange: d.exchange, currency: d.currency, price: d.price,
    marketTime: d.marketTime, stale: d.stale, error: d.error,
    analysis: a,
    candles: d.candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })),
  });
}));

module.exports = router;
