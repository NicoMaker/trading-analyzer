// Serie storiche per i grafici delle rendite, calcolate con i prezzi reali giornalieri (Yahoo Finance).
// I prezzi storici sono convertiti con il cambio attuale: per titoli in valuta estera e' un'approssimazione.
const { all } = require('../db/database');
const market = require('./market');

const DAY = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Ultima chiusura <= t (le candele sono ordinate); null prima della prima candela
function closeAt(candles, t) {
  let lo = 0, hi = candles.length - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].t <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit < 0 ? null : candles[hit].c;
}

async function loadMarket(symbols, currencies) {
  const data = new Map(), fx = new Map();
  await Promise.all([
    ...[...symbols].map(async (s) => { try { data.set(s, (await market.getSymbolData(s)).candles); } catch { /* titolo senza dati: escluso */ } }),
    ...[...currencies].filter((c) => c && c !== 'EUR').map(async (c) => { try { const r = await market.getFx(c); if (r.rate > 0) fx.set(c, r.rate); } catch { /* ignora */ } }),
  ]);
  fx.set('EUR', 1);
  return { data, fx };
}

function axis(candleLists, fromMs) {
  const set = new Set();
  for (const list of candleLists) for (const c of list) if (c.t >= fromMs) set.add(dayKey(c.t));
  return [...set].sort().map((k) => new Date(k + 'T23:59:59Z').getTime());
}

// Valore del portafoglio nel tempo (quote detenute alla data x chiusura) contro il costo medio sostenuto
async function portfolioSeries(ownerId, days = 180) {
  const [positions, ops] = await Promise.all([
    all('SELECT * FROM positions WHERE owner_id = ?', [ownerId]),
    all('SELECT * FROM operations WHERE owner_id = ? ORDER BY date, id', [ownerId]),
  ]);
  const byIsin = new Map(positions.map((p) => [p.isin, p]));
  const held = positions.filter((p) => p.ticker && ops.some((o) => o.isin === p.isin));
  if (!held.length) return { times: [], value: [], cost: [], pnl: [], pnlPct: [] };
  const { data, fx } = await loadMarket(new Set(held.map((p) => p.ticker)), new Set(held.map((p) => p.currency)));
  const from = Date.now() - days * DAY;
  const times = axis(held.map((p) => data.get(p.ticker) || []), from);

  const state = new Map(); // isin -> {qty,cost}
  let i = 0;
  const out = { times: [], value: [], cost: [], pnl: [], pnlPct: [] };
  const sorted = ops.filter((o) => byIsin.has(o.isin));
  for (const t of times) {
    const dk = dayKey(t);
    while (i < sorted.length && sorted[i].date <= dk) {
      const o = sorted[i++];
      const s = state.get(o.isin) || { qty: 0, cost: 0 };
      if (o.type === 'Acquisto') { s.cost += o.quantity * o.price * o.fx + o.fees; s.qty += o.quantity; }
      else if (s.qty > 0) { const take = Math.min(o.quantity, s.qty); const c = (s.cost / s.qty) * take; s.cost -= c; s.qty -= take; if (s.qty < 1e-8) { s.qty = 0; s.cost = 0; } }
      state.set(o.isin, s);
    }
    let value = 0, cost = 0, ok = true, any = false;
    for (const [isin, s] of state) {
      if (s.qty <= 0) continue;
      any = true;
      const p = byIsin.get(isin), px = closeAt(data.get(p.ticker) || [], t), rate = fx.get(p.currency);
      if (px == null || rate == null) { ok = false; break; }
      value += s.qty * px * rate; cost += s.cost;
    }
    if (!any || !ok) continue;
    out.times.push(t); out.value.push(value); out.cost.push(cost); out.pnl.push(value - cost); out.pnlPct.push(cost > 0 ? (value / cost - 1) * 100 : 0);
  }
  return out;
}

// Rendimento di un cliente nel tempo: valore delle sue allocazioni contro quanto ha investito.
// Le allocazioni chiuse restano al loro incasso reale dopo la vendita.
async function clientSeries(clientId, ownerId, days = 180) {
  const allocs = await all('SELECT * FROM allocations WHERE client_id = ? AND owner_id = ?', [clientId, ownerId]);
  if (!allocs.length) return { times: [], value: [], invested: [], pnl: [], pnlPct: [] };
  const positions = await all('SELECT * FROM positions WHERE owner_id = ?', [ownerId]);
  const byIsin = new Map(positions.map((p) => [p.isin, p]));
  const used = allocs.map((a) => byIsin.get(a.isin)).filter((p) => p && p.ticker);
  const { data, fx } = await loadMarket(new Set(used.map((p) => p.ticker)), new Set(used.map((p) => p.currency)));
  const first = allocs.reduce((m, a) => Math.min(m, Date.parse(a.created_at.replace(' ', 'T') + 'Z')), Infinity);
  const from = Math.max(Date.now() - days * DAY, first - 3 * DAY);
  const times = axis(used.map((p) => data.get(p.ticker) || []), from);
  const out = { times: [], value: [], invested: [], pnl: [], pnlPct: [] };
  for (const t of times) {
    let value = 0, invested = 0, ok = true;
    for (const a of allocs) {
      const created = Date.parse(a.created_at.replace(' ', 'T') + 'Z');
      if (created > t) continue;
      invested += a.euro;
      const entry = a.entry_price_eur > 0 ? a.entry_price_eur : null;
      const units = entry ? a.euro / entry : null;
      if (a.status === 'closed' && a.closed_at && Date.parse(a.closed_at) <= t) { value += units != null && a.exit_price_eur > 0 ? units * a.exit_price_eur : a.euro; continue; }
      const p = byIsin.get(a.isin), px = p && p.ticker ? closeAt(data.get(p.ticker) || [], t) : null, rate = p ? fx.get(p.currency) : null;
      if (units == null || px == null || rate == null) { ok = false; break; }
      value += units * px * rate;
    }
    if (!ok || invested <= 0) continue;
    out.times.push(t); out.value.push(value); out.invested.push(invested); out.pnl.push(value - invested); out.pnlPct.push((value / invested - 1) * 100);
  }
  return out;
}

module.exports = { portfolioSeries, clientSeries };
