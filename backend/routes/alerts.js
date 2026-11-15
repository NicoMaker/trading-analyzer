const express = require('express');
const { all } = require('../db/database');
const { loadPortfolio } = require('../services/portfolio');
const { wrap } = require('./helpers');

const router = express.Router();

// Tutti gli alert attivi adesso (calcolati sui dati reali) + storico degli ultimi giorni
router.get('/', wrap(async (req, res) => {
  const pf = await loadPortfolio(req.ownerId);
  const active = [];
  for (const p of pf.positions) for (const a of p.alerts) active.push({ ...a, isin: p.isin, name: p.name, ticker: p.ticker, positionId: p.id });
  for (const e of pf.ledgerErrors) active.push({ code: 'ledger', severity: 'danger', title: 'Operazione da correggere', message: e.error, isin: e.isin, name: e.isin });
  const order = { danger: 0, warning: 1, success: 2, info: 3 };
  active.sort((a, b) => order[a.severity] - order[b.severity]);
  const history = await all('SELECT isin, code, severity, message, day, created_at FROM alert_log WHERE owner_id = ? ORDER BY id DESC LIMIT 100', [req.ownerId]);
  res.json({ active, history, counts: {
    danger: active.filter((a) => a.severity === 'danger').length,
    warning: active.filter((a) => a.severity === 'warning').length,
    success: active.filter((a) => a.severity === 'success').length,
    info: active.filter((a) => a.severity === 'info').length,
  } });
}));

module.exports = router;
