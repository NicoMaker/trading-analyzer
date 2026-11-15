// Dati di mercato reali da Yahoo Finance (gratuito, senza chiave) + cambi da Frankfurter (BCE) come riserva.
// Tutto passa da una cache SQLite: se l'API non risponde si usa l'ultimo dato salvato, segnalandolo come "datato".
const config = require('../config');
const { get, all, run } = require('../db/database');

const UA = 'Mozilla/5.0 (compatible; TradingAnalyzer/1.0)';

async function fetchJson(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Prova ogni host in ordine finche' uno risponde.
async function yahoo(pathAndQuery) {
  let lastErr;
  for (const host of config.YAHOO_HOSTS) {
    try { return await fetchJson(host.replace(/\/$/, '') + pathAndQuery); }
    catch (e) { lastErr = e; }
  }
  throw new Error(`Yahoo Finance non raggiungibile (${lastErr && lastErr.message})`);
}

// --- Parsing della risposta "chart" di Yahoo ---------------------------------------------------
function parseChart(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r) {
    const desc = json && json.chart && json.chart.error && json.chart.error.description;
    throw new Error(desc || 'Simbolo non trovato');
  }
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const ts = r.timestamp || [];
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close && q.close[i];
    if (c == null || !isFinite(c)) continue; // giorni festivi: Yahoo restituisce null
    candles.push({
      t: ts[i] * 1000,
      o: q.open[i] ?? c, h: q.high[i] ?? c, l: q.low[i] ?? c, c,
      v: (q.volume && q.volume[i]) || 0,
    });
  }
  const meta = r.meta || {};
  let price = meta.regularMarketPrice != null ? meta.regularMarketPrice : candles.length ? candles[candles.length - 1].c : null;
  let currency = meta.currency || 'EUR';
  // Borsa di Londra: Yahoo quota in pence ("GBp"). Si converte in sterline.
  let factor = 1;
  if (currency === 'GBp' || currency === 'GBX') { currency = 'GBP'; factor = 0.01; }
  if (currency === 'ILA') { currency = 'ILS'; factor = 0.01; }
  if (factor !== 1) {
    price = price * factor;
    for (const c of candles) { c.o *= factor; c.h *= factor; c.l *= factor; c.c *= factor; }
  }
  return {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    currency, price,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : candles.length ? candles[candles.length - 1].t : null,
    candles,
  };
}

async function downloadSymbol(symbol) {
  const json = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`);
  return parseChart(json);
}

// --- Cache -------------------------------------------------------------------------------------
const inflight = new Map(); // evita download doppi dello stesso simbolo

async function getSymbolData(symbol, { force = false, maxAgeMs = config.QUOTE_TTL_MS, cacheOnly = false } = {}) {
  symbol = String(symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('Ticker mancante');
  const cached = await get('SELECT * FROM market_cache WHERE symbol = ?', [symbol]);
  const fresh = cached && cached.price != null && Date.now() - cached.fetched_at < maxAgeMs;
  if (cacheOnly) { if (cached && cached.price != null) return fromRow(cached, !fresh); throw new Error('non in cache'); }
  if (fresh && !force) return fromRow(cached, false);

  if (inflight.has(symbol)) return inflight.get(symbol);
  const p = (async () => {
    try {
      const d = await downloadSymbol(symbol);
      await run(
        `INSERT INTO market_cache (symbol, name, exchange, currency, price, market_time, candles, fetched_at, last_error)
         VALUES (?,?,?,?,?,?,?,?,NULL)
         ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, currency=excluded.currency,
           price=excluded.price, market_time=excluded.market_time, candles=excluded.candles, fetched_at=excluded.fetched_at, last_error=NULL`,
        [symbol, d.name, d.exchange, d.currency, d.price, d.marketTime, JSON.stringify(d.candles), Date.now()]);
      return { symbol, name: d.name, exchange: d.exchange, currency: d.currency, price: d.price, marketTime: d.marketTime, candles: d.candles, fetchedAt: Date.now(), stale: false, error: null };
    } catch (e) {
      await run(`INSERT INTO market_cache (symbol, fetched_at, last_error) VALUES (?,0,?)
                 ON CONFLICT(symbol) DO UPDATE SET last_error=excluded.last_error`, [symbol, e.message]).catch(() => {});
      if (cached && cached.price != null) return { ...fromRow(cached, true), error: e.message };
      throw e;
    } finally { inflight.delete(symbol); }
  })();
  inflight.set(symbol, p);
  return p;
}

function fromRow(r, stale) {
  return {
    symbol: r.symbol, name: r.name, exchange: r.exchange, currency: r.currency, price: r.price,
    marketTime: r.market_time, candles: r.candles ? JSON.parse(r.candles) : [], fetchedAt: r.fetched_at,
    stale, error: r.last_error || null,
  };
}

// --- Cambi: EUR per 1 unita' di valuta -----------------------------------------------------------
async function getFx(currency, { force = false } = {}) {
  currency = String(currency || 'EUR').toUpperCase();
  if (currency === 'EUR') return { rate: 1, stale: false };
  const cached = await get('SELECT * FROM fx_cache WHERE currency = ?', [currency]);
  if (cached && !force && Date.now() - cached.fetched_at < config.QUOTE_TTL_MS) return { rate: cached.eur_per_unit, stale: false };
  let rate = null;
  try {
    const d = parseChart(await yahoo(`/v8/finance/chart/${currency}EUR%3DX?range=5d&interval=1d`));
    if (d.price > 0) rate = d.price;
  } catch { /* si prova la riserva */ }
  if (rate == null) {
    try {
      const j = await fetchJson(`${config.FX_FALLBACK_URL}?base=${encodeURIComponent(currency)}&symbols=EUR`);
      if (j && j.rates && j.rates.EUR > 0) rate = j.rates.EUR;
    } catch { /* nessuna riserva disponibile */ }
  }
  if (rate != null) {
    await run(`INSERT INTO fx_cache (currency, eur_per_unit, fetched_at) VALUES (?,?,?)
               ON CONFLICT(currency) DO UPDATE SET eur_per_unit=excluded.eur_per_unit, fetched_at=excluded.fetched_at`, [currency, rate, Date.now()]);
    return { rate, stale: false };
  }
  if (cached) return { rate: cached.eur_per_unit, stale: true };
  return { rate: null, stale: true };
}

// --- Ricerca titoli (per nome, ticker o ISIN) ----------------------------------------------------
async function search(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const json = await yahoo(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`);
  return ((json && json.quotes) || [])
    .filter((x) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(x.quoteType))
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || null,
      type: x.quoteType,
      sector: x.sectorDisp || x.sector || null,
      industry: x.industryDisp || x.industry || null,
    }));
}

// --- Prezzo storico a una data (per compilare gli acquisti) ---------------------------------------
// Usa le chiusure giornaliere dell'ultimo anno: prende l'ultima seduta fino alla data indicata (YYYY-MM-DD).
async function priceAt(symbol, date) {
  const d = await getSymbolData(symbol);
  const limit = new Date(date + 'T23:59:59Z').getTime();
  const first = d.candles[0];
  if (!first || limit < first.t - 86400000) throw new Error('Data oltre l\'ultimo anno: inserisci il prezzo a mano');
  let hit = null;
  for (const c of d.candles) { if (c.t <= limit) hit = c; else break; }
  if (!hit) throw new Error('Nessuna quotazione disponibile a quella data');
  return { price: hit.c, priceDate: new Date(hit.t).toISOString().slice(0, 10), currency: d.currency };
}

// Cambio BCE (Frankfurter) alla data: EUR per 1 unita' di valuta. null se non disponibile.
async function getFxAt(currency, date) {
  currency = String(currency || 'EUR').toUpperCase();
  if (currency === 'EUR') return 1;
  try {
    const base = config.FX_FALLBACK_URL.replace(/\/latest$/, '');
    const j = await fetchJson(`${base}/${date}?base=${encodeURIComponent(currency)}&symbols=EUR`);
    if (j && j.rates && j.rates.EUR > 0) return j.rates.EUR;
  } catch { /* si lascia vuoto */ }
  return null;
}

const looksLikeIsin = (s) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(s || '').toUpperCase());

// Dato un ISIN, restituisce il primo titolo trovato da Yahoo Finance (ticker, nome, settore).
async function resolveIsin(isin) {
  const res = await search(isin);
  return res[0] || null;
}

module.exports = { getSymbolData, getFx, priceAt, getFxAt, search, resolveIsin, looksLikeIsin, parseChart };
