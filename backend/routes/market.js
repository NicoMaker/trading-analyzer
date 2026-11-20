const express = require("express");
const config = require("../config");
const { all } = require("../db/database");
const market = require("../services/market");
const { CATALOG } = require("../services/catalog");
const { wrap, bad } = require("./helpers");

const router = express.Router();

// Elenco titoli per la ricerca:
//  - nessun testo  -> TUTTI i titoli (quelli gia' in portafoglio + elenco di aziende quotate) con prezzo reale
//  - con un testo  -> i risultati di Yahoo Finance (nome, ticker o ISIN) e le corrispondenze dell'elenco locale
// Nessun limite di tempo ne' di numero: ogni titolo dell'elenco riceve sempre il prezzo aggiornato
// (cache di soli QUOTE_TTL_MS secondi; se Yahoo non risponde si usa l'ultimo prezzo salvato, segnato come "stale").
async function withPrices(items, limit = 12) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      try {
        const d = await market.getSymbolData(it.symbol, {
          maxAgeMs: config.QUOTE_TTL_MS,
        });
        it.price = d.price;
        it.currency = d.currency;
        it.name = it.name || d.name;
        it.stale = d.stale;
        const c = d.candles,
          n = c.length;
        if (n > 1 && d.price)
          it.dayChangePct = (d.price / c[n - 2].c - 1) * 100;
      } catch {
        it.price = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return items;
}

async function localList(ownerId, q) {
  const own = await all(
    "SELECT ticker, name, currency, sector FROM positions WHERE owner_id = ? AND ticker IS NOT NULL",
    [ownerId],
  );
  const mine = new Set(own.map((p) => p.ticker.toUpperCase()));
  const items = [
    ...own.map((p) => ({
      symbol: p.ticker.toUpperCase(),
      name: p.name,
      exchange: null,
      type: "EQUITY",
      sector: p.sector,
    })),
    ...CATALOG.filter((c) => !mine.has(c.symbol)),
  ].map((x) => ({ ...x, inPortfolio: mine.has(x.symbol) }));
  const t = q.toLowerCase();
  return t
    ? items.filter(
        (x) =>
          x.symbol.toLowerCase().includes(t) ||
          String(x.name).toLowerCase().includes(t),
      )
    : items;
}

// Elenco di TUTTI i titoli (portafoglio + elenco quotati) senza attendere i prezzi: risposta immediata.
// I prezzi gia' in cache si aggiungono se presenti; gli altri arrivano da /search.
router.get(
  "/catalog",
  wrap(async (req, res) => {
    const items = await localList(req.ownerId, "");
    for (const it of items) {
      try {
        const d = await market.getSymbolData(it.symbol, {
          maxAgeMs: Infinity,
          cacheOnly: true,
        });
        it.price = d.price;
        it.currency = d.currency;
        it.stale = d.stale;
      } catch {
        /* senza prezzo in cache: arriva dopo */
      }
    }
    res.json(items);
  }),
);

router.get(
  "/search",
  wrap(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const local = await localList(req.ownerId, q);
    if (q.length < 2) return res.json(await withPrices(local)); // vuoto o 1 carattere: solo l'elenco locale
    let remote = [],
      remoteError = null;
    try {
      remote = await market.search(q);
    } catch (e) {
      remoteError = e.message;
    }
    const seen = new Set(local.map((x) => x.symbol));
    const mine = new Set(
      local.filter((x) => x.inPortfolio).map((x) => x.symbol),
    );
    const merged = [
      ...local,
      ...remote
        .filter((r) => !seen.has(r.symbol))
        .map((r) => ({ ...r, inPortfolio: mine.has(r.symbol) })),
    ];
    if (!merged.length && remoteError)
      return res
        .status(502)
        .json({ error: `Ricerca non disponibile: ${remoteError}` });
    res.json(await withPrices(merged));
  }),
);

// Quotazione in tempo (quasi) reale di un ticker + cambio verso EUR
router.get(
  "/quote/:symbol",
  wrap(async (req, res) => {
    try {
      const d = await market.getSymbolData(req.params.symbol, {
        force: req.query.force === "1",
      });
      const fx = await market.getFx(d.currency);
      res.json({
        symbol: d.symbol,
        name: d.name,
        exchange: d.exchange,
        currency: d.currency,
        price: d.price,
        marketTime: d.marketTime,
        fxEur: fx.rate,
        stale: d.stale,
      });
    } catch (e) {
      res
        .status(502)
        .json({ error: `Quotazione non disponibile: ${e.message}` });
    }
  }),
);

// Prezzo di mercato e cambio a una data passata (per compilare un acquisto)
router.get(
  "/price-at",
  wrap(async (req, res) => {
    const symbol = String(req.query.symbol || "").trim();
    const date = String(req.query.date || "");
    if (!symbol) throw bad("Ticker mancante: impostalo sul titolo");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad("Data non valida");
    try {
      const r = await market.priceAt(symbol, date);
      res.json({ ...r, fx: await market.getFxAt(r.currency, date) });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }),
);

// Forza il riscaricamento dei dati di tutti i titoli del portafoglio
router.post(
  "/refresh",
  wrap(async (req, res) => {
    const rows = await all(
      "SELECT DISTINCT ticker, currency FROM positions WHERE owner_id = ? AND ticker IS NOT NULL",
      [req.ownerId],
    );
    const results = await Promise.all(
      rows.map(async (r) => {
        try {
          await market.getSymbolData(r.ticker, { force: true });
          if (r.currency !== "EUR")
            await market.getFx(r.currency, { force: true });
          return { ticker: r.ticker, ok: true };
        } catch (e) {
          return { ticker: r.ticker, ok: false, error: e.message };
        }
      }),
    );
    res.json({ results, failed: results.filter((x) => !x.ok).length });
  }),
);

module.exports = router;
