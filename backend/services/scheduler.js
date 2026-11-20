// Aggiornamento automatico in background (ogni REFRESH_INTERVAL_MS, default 60 s):
//  1. scarica le quotazioni reali di tutti i titoli aperti
//  2. esegue il controllo rischio (stop loss / perdita massima => vendita forzata dei clienti)
//  3. registra gli alert nuovi (una volta al giorno per titolo e tipo) e li notifica in diretta
//  4. avvisa via socket.io tutti i client collegati, che aggiornano i dati a schermo
const config = require("../config");
const { all, run } = require("../db/database");
const market = require("./market");
const { loadPortfolio, clientHoldings } = require("./portfolio");
const { runRisk } = require("./trading");
const { notifyUser, notifyClient } = require("./notify");
const realtime = require("../realtime");

let running = false;

async function refreshAll() {
  if (running) return;
  running = true;
  try {
    const rows = await all(
      "SELECT DISTINCT ticker, currency FROM positions WHERE ticker IS NOT NULL",
    );
    for (const r of rows) {
      try {
        await market.getSymbolData(r.ticker, { force: true });
        if (r.currency !== "EUR")
          await market.getFx(r.currency, { force: true });
      } catch (e) {
        console.warn(`[quotazioni] ${r.ticker}: ${e.message}`);
      }
    }
    const owners = await all("SELECT DISTINCT owner_id FROM positions");
    const day = new Date().toISOString().slice(0, 10);
    for (const { owner_id } of owners) {
      try {
        await runRisk(owner_id);
        const pf = await loadPortfolio(owner_id);
        for (const p of pf.positions) {
          for (const a of p.alerts) {
            if (a.severity === "info") continue;
            const r = await run(
              "INSERT OR IGNORE INTO alert_log (owner_id, isin, code, severity, message, day) VALUES (?,?,?,?,?,?)",
              [
                owner_id,
                p.isin,
                a.code,
                a.severity,
                `${a.title}: ${a.message}`,
                day,
              ],
            );
            if (r.changes)
              await notifyUser(owner_id, {
                kind: "alert",
                severity: a.severity,
                title: `${p.name}: ${a.title}`,
                message: a.message,
              });
          }
        }
        // Alert di titolo per ogni cliente che lo possiede
        const allocs = await all(
          "SELECT * FROM allocations WHERE owner_id = ? AND status = 'open'",
          [owner_id],
        );
        for (const h of clientHoldings(allocs, pf.positions)) {
          for (const a of h.alerts) {
            const r = await run(
              "INSERT OR IGNORE INTO alert_log (owner_id, isin, code, severity, message, day) VALUES (?,?,?,?,?,?)",
              [
                owner_id,
                `c${h.clientId}:${h.isin}`,
                a.code,
                a.severity,
                `${a.title}: ${a.message}`,
                day,
              ],
            );
            if (r.changes)
              await notifyClient(h.clientId, {
                kind: "alert",
                severity: a.severity,
                title: `${h.name}: ${a.title}`,
                message: a.message,
              });
          }
        }
        realtime.toOwner(owner_id, "portfolio:update", {
          at: Date.now(),
          totals: pf.totals,
        });
      } catch (e) {
        console.error(`[scheduler] portafoglio ${owner_id}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[scheduler]", e);
  } finally {
    running = false;
  }
}

function start() {
  setTimeout(refreshAll, 3000);
  const t = setInterval(refreshAll, config.REFRESH_INTERVAL_MS);
  t.unref();
}

module.exports = { start, refreshAll };
