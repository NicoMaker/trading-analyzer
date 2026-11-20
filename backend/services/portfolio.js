// Logica del foglio "Controllo azioni" portata in codice:
//  - registro operazioni con prezzo medio mobile (le vendite scaricano il costo al prezzo medio precedente)
//  - posizioni con valore, utile/perdita, peso, realizzato, dividendi
//  - controlli di validita' sulle operazioni (stessi del foglio)
const { all } = require("../db/database");
const market = require("./market");
const { analyze } = require("./indicators");
const { evaluateAlerts } = require("./alerts");

const EPS = 1e-8;
const round = (n, d = 6) =>
  n == null ? null : Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------
// Validazione di una singola operazione (come la colonna "Controllo" del foglio Operazioni)
// ---------------------------------------------------------------------------------------------
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function validateOperation(o) {
  const num = (v) => (v === "" || v == null ? NaN : Number(v));
  if (!o.isin || !String(o.isin).trim()) return "ISIN mancante";
  if (!isValidDate(o.date)) return "Data non valida (formato AAAA-MM-GG)";
  if (o.date > new Date().toISOString().slice(0, 10))
    return "La data non puo' essere nel futuro";
  if (o.type !== "Acquisto" && o.type !== "Vendita")
    return "Tipo errato: usa Acquisto o Vendita";
  const q = num(o.quantity),
    p = num(o.price),
    fx = num(o.fx),
    fees = num(o.fees);
  if (![q, p, fx, fees].every(Number.isFinite))
    return "Numeri errati o mancanti";
  if (q <= 0 || p <= 0 || fx <= 0 || fees < 0)
    return "Valori non validi (quantita, prezzo e cambio > 0; commissioni >= 0)";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Registro: elabora le operazioni in ordine cronologico (data, poi ordine di inserimento).
// ---------------------------------------------------------------------------------------------
function computeLedger(ops) {
  const sorted = [...ops].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id,
  );
  const state = new Map(); // isin -> {qty, cost, realized}
  const errors = [];
  const rows = [];
  for (const o of sorted) {
    const s = state.get(o.isin) || { qty: 0, cost: 0, realized: 0 };
    const q = Number(o.quantity),
      p = Number(o.price),
      fx = Number(o.fx),
      fees = Number(o.fees);
    const row = {
      id: o.id,
      date: o.date,
      isin: o.isin,
      type: o.type,
      quantity: q,
      price: p,
      fx,
      fees,
      note: o.note || "",
    };
    if (o.type === "Acquisto") {
      const buy = q * p * fx + fees;
      row.amountEur = buy;
      row.costSold = 0;
      row.result = 0;
      s.cost += buy;
      s.qty += q;
    } else {
      if (q > s.qty + EPS) {
        errors.push({
          id: o.id,
          isin: o.isin,
          error: `Vendita oltre saldo (${o.isin}: disponibili ${round(s.qty, 6)}, vendute ${q})`,
        });
        row.error = "Vendita oltre saldo";
        rows.push(row);
        continue;
      }
      const net = q * p * fx - fees;
      const costSold = s.qty === 0 ? 0 : (s.cost / s.qty) * q;
      row.amountEur = net;
      row.costSold = costSold;
      row.result = net - costSold;
      s.cost -= costSold;
      s.qty -= q;
      s.realized += net - costSold;
      if (s.qty < EPS) {
        s.qty = 0;
        s.cost = 0;
      }
    }
    state.set(o.isin, s);
    rows.push(row);
  }
  return { state, errors, rows };
}

// ---------------------------------------------------------------------------------------------
// Caricamento completo del portafoglio di un utente con quotazioni reali
// ---------------------------------------------------------------------------------------------
async function loadPortfolio(ownerId) {
  const [positions, ops, allocs] = await Promise.all([
    all(
      "SELECT * FROM positions WHERE owner_id = ? ORDER BY name COLLATE NOCASE",
      [ownerId],
    ),
    all("SELECT * FROM operations WHERE owner_id = ? ORDER BY date, id", [
      ownerId,
    ]),
    all("SELECT * FROM allocations WHERE owner_id = ? AND status = 'open'", [
      ownerId,
    ]),
  ]);
  const ledger = computeLedger(ops);

  // Quotazioni (una sola richiesta per ticker/valuta, in parallelo; un errore non blocca il resto)
  const tickers = [...new Set(positions.map((p) => p.ticker).filter(Boolean))];
  const currencies = [
    ...new Set(
      positions.map((p) => p.currency).filter((c) => c && c !== "EUR"),
    ),
  ];
  const quoteMap = new Map(),
    fxMap = new Map(),
    errMap = new Map();
  await Promise.all([
    ...tickers.map(async (t) => {
      try {
        quoteMap.set(t, await market.getSymbolData(t));
      } catch (e) {
        errMap.set(t, e.message);
      }
    }),
    ...currencies.map(async (c) => {
      try {
        fxMap.set(c, await market.getFx(c));
      } catch {
        /* resta senza cambio */
      }
    }),
  ]);

  const allocByIsin = new Map();
  for (const a of allocs)
    allocByIsin.set(a.isin, (allocByIsin.get(a.isin) || 0) + a.euro);

  const today = new Date().toISOString().slice(0, 10);
  const rows = positions.map((p) => {
    const st = ledger.state.get(p.isin) || { qty: 0, cost: 0, realized: 0 };
    const hasOps = ledger.state.has(p.isin);
    const q = p.ticker ? quoteMap.get(p.ticker) : null;
    const fxd =
      p.currency === "EUR" ? { rate: 1, stale: false } : fxMap.get(p.currency);

    // Prezzo: API -> cache datata -> prezzo manuale
    let price = null,
      priceSource = null,
      quoteTime = null,
      quoteStale = false;
    if (q && q.price > 0) {
      price = q.price;
      priceSource = q.stale ? "cache" : "api";
      quoteTime = q.marketTime;
      quoteStale = q.stale;
    } else if (p.manual_price > 0) {
      price = p.manual_price;
      priceSource = "manuale";
    }
    let fx = null;
    if (fxd && fxd.rate > 0) fx = fxd.rate;
    else if (p.manual_fx > 0) fx = p.manual_fx;
    if (p.currency === "EUR") fx = 1;

    const analysis = q && q.candles.length > 1 ? analyze(q.candles) : null;
    let dayChangePct = null;
    if (q && q.candles.length > 1 && price != null) {
      const n = q.candles.length;
      const lastDay = new Date(q.candles[n - 1].t).toISOString().slice(0, 10);
      const quoteDay = quoteTime
        ? new Date(quoteTime).toISOString().slice(0, 10)
        : lastDay;
      const prev =
        lastDay === quoteDay ? q.candles[n - 2].c : q.candles[n - 1].c;
      if (prev > 0) dayChangePct = (price / prev - 1) * 100;
    }

    const qty = st.qty;
    const value =
      hasOps && price != null && fx != null
        ? qty * price * fx
        : qty === 0
          ? 0
          : null;
    const cost = st.cost;
    const pnl = value != null ? value - cost : null;
    return {
      id: p.id,
      isin: p.isin,
      name: p.name,
      ticker: p.ticker,
      currency: p.currency,
      sector: p.sector,
      risk: p.risk,
      maxWeight: p.max_weight,
      stopPrice: p.stop_price,
      targetPrice: p.target_price,
      minValueEur: p.min_value_eur,
      minPlPct: p.min_pl_pct,
      dayDropPct: p.day_drop_pct,
      rsiLow: p.rsi_low,
      rsiHigh: p.rsi_high,
      nextReview: p.next_review,
      dividends: p.dividends,
      manualPrice: p.manual_price,
      manualFx: p.manual_fx,
      notes: p.notes,
      quantity: qty,
      cost,
      avgPrice: qty > 0 ? cost / qty : null,
      price,
      fx,
      priceSource,
      quoteTime,
      quoteStale,
      quoteError: p.ticker
        ? errMap.get(p.ticker) || (q && q.error) || null
        : "Ticker non impostato",
      value,
      pnl,
      pnlPct: pnl != null && cost > 0 ? (pnl / cost) * 100 : null,
      realized: st.realized,
      hasOperations: hasOps,
      dayChangePct,
      allocatedEur: allocByIsin.get(p.isin) || 0,
      trend: analysis && analysis.enough ? analysis.trend : null,
      rsi: analysis && analysis.enough ? analysis.values.rsi : null,
      _analysis: analysis,
    };
  });

  // Pesi: calcolati solo se tutte le posizioni aperte hanno un valore (come nel foglio)
  const open = rows.filter((r) => r.quantity > 0);
  const allPriced = open.every((r) => r.value != null);
  const totalValue = allPriced ? open.reduce((s, r) => s + r.value, 0) : null;
  for (const r of rows)
    r.weight =
      allPriced && totalValue > 0 && r.quantity > 0
        ? (r.value / totalValue) * 100
        : null;

  for (const r of rows) {
    r.alerts = evaluateAlerts(r, { today, analysis: r._analysis });
    delete r._analysis;
  }

  const totals = {
    cost: open.reduce((s, r) => s + r.cost, 0),
    value: totalValue,
    pnl: allPriced ? totalValue - open.reduce((s, r) => s + r.cost, 0) : null,
    realized: rows.reduce((s, r) => s + r.realized, 0),
    dividends: rows.reduce((s, r) => s + (r.dividends || 0), 0),
    openPositions: open.length,
    quotesMissing: open.filter((r) => r.value == null).length,
  };
  totals.pnlPct =
    totals.pnl != null && totals.cost > 0
      ? (totals.pnl / totals.cost) * 100
      : null;

  return {
    positions: rows,
    totals,
    ledgerErrors: ledger.errors,
    generatedAt: Date.now(),
  };
}

// Vista per cliente: quanto e' stato assegnato a ogni titolo e come sta andando.
// Aperta: valore attuale = euro assegnati x (prezzo EUR attuale / prezzo EUR all'assegnazione).
// Chiusa (venduta a mano o in automatico): valore = incasso reale alla vendita.
function clientHoldings(allocs, portfolioPositions) {
  const byIsin = new Map(portfolioPositions.map((p) => [p.isin, p]));
  return allocs.map((a) => {
    const p = byIsin.get(a.isin);
    const closed = a.status === "closed";
    const curEur = p && p.price != null && p.fx != null ? p.price * p.fx : null;
    const entry = a.entry_price_eur > 0 ? a.entry_price_eur : null;
    const units = entry ? a.euro / entry : null;
    let value;
    if (closed)
      value =
        units != null && a.exit_price_eur > 0
          ? units * a.exit_price_eur
          : a.euro;
    else value = units != null && curEur != null ? units * curEur : null;
    return {
      id: a.id,
      clientId: a.client_id,
      isin: a.isin,
      name: p ? p.name : a.isin,
      ticker: p ? p.ticker : null,
      currency: p ? p.currency : null,
      euro: a.euro,
      entryPriceEur: entry,
      units,
      currentPriceEur: curEur,
      value,
      status: a.status || "open",
      stopLossPct: a.stop_loss_pct,
      closedAt: a.closed_at || null,
      exitPriceEur: a.exit_price_eur || null,
      exitReason: a.exit_reason || null,
      pnl: value != null ? value - a.euro : null,
      pnlPct: value != null ? (value / a.euro - 1) * 100 : null,
      note: a.note,
      createdAt: a.created_at,
      alerts:
        !closed && p
          ? p.alerts.filter(
              (x) => x.severity === "danger" || x.severity === "warning",
            )
          : [],
    };
  });
}

// Totali di un cliente: capitale, liquidita' (cosa puo' ancora investire), investito in aperto, realizzato, patrimonio.
function clientTotals(client, holdings) {
  const open = holdings.filter((x) => x.status === "open"),
    closed = holdings.filter((x) => x.status === "closed");
  const invested = open.reduce((s, x) => s + x.euro, 0);
  const priced = open.every((x) => x.value != null);
  const value = priced ? open.reduce((s, x) => s + x.value, 0) : null;
  const realized = closed.reduce((s, x) => s + (x.value - x.euro), 0);
  const capital = client.capital || 0;
  const cash =
    capital -
    holdings.reduce((s, x) => s + x.euro, 0) +
    closed.reduce((s, x) => s + x.value, 0);
  const equity = value != null ? cash + value : null;
  const pnl = value != null ? value - invested : null;
  return {
    capital,
    cash,
    invested,
    value,
    pnl,
    pnlPct: pnl != null && invested > 0 ? (value / invested - 1) * 100 : null,
    realized,
    equity,
    totalPnl: equity != null ? equity - capital : null,
    totalPnlPct:
      equity != null && capital > 0 ? (equity / capital - 1) * 100 : null,
    openCount: open.length,
    closedCount: closed.length,
  };
}

module.exports = {
  validateOperation,
  isValidDate,
  computeLedger,
  loadPortfolio,
  clientHoldings,
  clientTotals,
};
