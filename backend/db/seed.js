#!/usr/bin/env node
// Dati dimostrativi: utente, clienti, titoli, operazioni, allocazioni, notifiche e quotazioni di esempio.
//
//   npm run seed                 aggiunge i dati demo (non tocca niente altro)
//   npm run seed -- --reset      cancella i dati demo precedenti e li ricrea
//   DB_FILE=/tmp/prova.db npm run seed      su un database diverso
//
// I prezzi sono inventati (passeggiata casuale sempre uguale a ogni esecuzione): servono a vedere l'app
// popolata anche senza internet. Con la rete, le quotazioni vere sostituiscono quelle di esempio.
const bcrypt = require("bcryptjs");
const config = require("../config");
const { init, run, get, all, transaction } = require("./database");
const { computeLedger } = require("../services/portfolio");

const RESET = process.argv.includes("--reset");
const FX_USD = 0.92; // EUR per 1 USD (dimostrativo)

const USERS = {
  demo: { name: "Utente Demo", password: "Demo123!", role: "utente" },
  "mario.rossi": {
    name: "Mario Rossi",
    password: "Cliente123!",
    role: "cliente",
  },
  "giulia.bianchi": {
    name: "Giulia Bianchi",
    password: "Cliente123!",
    role: "cliente",
  },
};

const CLIENTS = [
  {
    key: "mario",
    name: "Mario Rossi",
    email: "mario.rossi@example.com",
    capital: 25000,
    stop: 10,
    dd: 20,
    login: "mario.rossi",
    notes: "Profilo prudente, orizzonte 5 anni",
  },
  {
    key: "giulia",
    name: "Giulia Bianchi",
    email: "giulia.bianchi@example.com",
    capital: 15000,
    stop: 8,
    dd: 15,
    login: "giulia.bianchi",
    notes: "Preferisce titoli europei",
  },
  {
    key: "verdi",
    name: "Studio Verdi",
    email: "info@studioverdi.example.com",
    capital: 40000,
    stop: 12,
    dd: 25,
    login: null,
    notes: "Società: tecnologia e semiconduttori",
  },
];

// base = prezzo di oggi (nella valuta del titolo), vol = oscillazione giornaliera, drift = tendenza giornaliera
const STOCKS = [
  {
    t: "AAPL",
    isin: "US0378331005",
    name: "Apple Inc.",
    cur: "USD",
    ex: "NASDAQ",
    sector: "Tecnologia",
    risk: "Medio",
    base: 232,
    vol: 0.015,
    drift: 0.0006,
    weight: 25,
    review: "2027-01-15",
  },
  {
    t: "MSFT",
    isin: "US5949181045",
    name: "Microsoft Corporation",
    cur: "USD",
    ex: "NASDAQ",
    sector: "Tecnologia",
    risk: "Medio",
    base: 438,
    vol: 0.013,
    drift: 0.0004,
    weight: 25,
    review: "2027-02-01",
  },
  {
    t: "NVDA",
    isin: "US67066G1040",
    name: "NVIDIA Corporation",
    cur: "USD",
    ex: "NASDAQ",
    sector: "Semiconduttori",
    risk: "Alto",
    base: 142,
    vol: 0.026,
    drift: 0.0009,
    weight: 12,
    review: "2026-12-20",
  },
  {
    t: "ENI.MI",
    isin: "IT0003132476",
    name: "Eni S.p.A.",
    cur: "EUR",
    ex: "Milano",
    sector: "Energia",
    risk: "Medio",
    base: 14.6,
    vol: 0.012,
    drift: -0.0001,
    weight: 15,
    review: "2026-11-10",
    minPl: -5,
  },
  {
    t: "ISP.MI",
    isin: "IT0000072618",
    name: "Intesa Sanpaolo S.p.A.",
    cur: "EUR",
    ex: "Milano",
    sector: "Banche",
    risk: "Medio",
    base: 4.55,
    vol: 0.013,
    drift: 0.0005,
    weight: 15,
    review: "2027-03-01",
  },
  {
    t: "SAP.DE",
    isin: "DE0007164600",
    name: "SAP SE",
    cur: "EUR",
    ex: "XETRA",
    sector: "Software",
    risk: "Medio",
    base: 238,
    vol: 0.014,
    drift: 0.0004,
    weight: 20,
    review: "2026-11-01",
  },
  {
    t: "ASML.AS",
    isin: "NL0010273215",
    name: "ASML Holding N.V.",
    cur: "EUR",
    ex: "Amsterdam",
    sector: "Semiconduttori",
    risk: "Alto",
    base: 690,
    vol: 0.019,
    drift: 0.0003,
    weight: 15,
    review: "2027-01-31",
  },
  {
    t: "VWCE.DE",
    isin: "IE00BK5BQT80",
    name: "Vanguard FTSE All-World UCITS ETF",
    cur: "EUR",
    ex: "XETRA",
    sector: "ETF azionario globale",
    risk: "Basso",
    base: 127,
    vol: 0.007,
    drift: 0.0004,
    weight: 40,
    review: "2027-06-30",
  },
];

// Operazioni: d = giorni fa, c = cliente a cui è assegnato l'acquisto (euro) | senza c = quote libere (n)
const OPS = [
  { s: "AAPL", d: 300, n: 40 },
  { s: "AAPL", d: 90, n: 20 },
  { s: "MSFT", d: 260, n: 15 },
  { s: "NVDA", d: 240, n: 60 },
  { s: "NVDA", d: 40, type: "Vendita", n: 20 },
  { s: "ENI.MI", d: 280, n: 400 },
  { s: "ENI.MI", d: 30, type: "Vendita", n: 100 },
  { s: "ISP.MI", d: 200, n: 1500 },
  { s: "SAP.DE", d: 150, n: 20 },
  { s: "ASML.AS", d: 120, n: 6 },
  { s: "VWCE.DE", d: 220, n: 80 },
  { s: "VWCE.DE", d: 60, n: 40 },
];
const ALLOCS = [
  { c: "mario", s: "AAPL", d: 100, euro: 3000 },
  { c: "mario", s: "VWCE.DE", d: 80, euro: 5000 },
  { c: "mario", s: "ENI.MI", d: 70, euro: 1500 },
  { c: "giulia", s: "MSFT", d: 90, euro: 4000 },
  { c: "giulia", s: "SAP.DE", d: 50, euro: 2500 },
  { c: "giulia", s: "ENI.MI", d: 160, euro: 1000, closeD: 20 }, // già venduta
  { c: "verdi", s: "NVDA", d: 110, euro: 6000 },
  { c: "verdi", s: "ASML.AS", d: 45, euro: 3500 },
  { c: "verdi", s: "ISP.MI", d: 35, euro: 2000 },
];

// --- numeri casuali ripetibili ---------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// ~260 giorni di borsa (lun-ven) che finiscono nell'ultimo giorno feriale
function weekdays(n) {
  const out = [];
  const d = new Date();
  d.setUTCHours(15, 30, 0, 0);
  while (out.length < n) {
    if (d.getUTCDay() % 6 !== 0) out.unshift(d.getTime());
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function candlesFor(st, days) {
  const r = rng([...st.t].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const closes = [100];
  for (let i = 1; i < days.length; i++)
    closes.push(closes[i - 1] * Math.exp(st.drift + st.vol * gauss(r)));
  const k = st.base / closes[closes.length - 1]; // l'ultimo prezzo coincide con "base"
  return days.map((t, i) => {
    const c = closes[i] * k;
    const o = (i ? closes[i - 1] * k : c) * (1 + (r() - 0.5) * st.vol * 0.4);
    const spread = st.vol * (0.3 + r() * 0.7);
    return {
      t,
      o: r4(o),
      h: r4(Math.max(o, c) * (1 + spread / 2)),
      l: r4(Math.min(o, c) * (1 - spread / 2)),
      c: r4(c),
      v: Math.round(2e5 + r() * 3e6),
    };
  });
}

async function removeDemo() {
  const demo = await get("SELECT id FROM users WHERE username = ?", ["demo"]);
  // i logins cliente puntano ai clienti: si tolgono prima, poi l'utente demo porta via con sé tutto il resto
  await run(
    "DELETE FROM users WHERE username IN ('mario.rossi','giulia.bianchi')",
  );
  if (demo) await run("DELETE FROM users WHERE id = ?", [demo.id]);
}

async function main() {
  await init();
  await run("PRAGMA foreign_keys = ON");

  const exists = await get("SELECT id FROM users WHERE username = ?", ["demo"]);
  if (exists && !RESET) {
    console.log(
      "I dati demo ci sono già (utente «demo»). Per rifarli: npm run seed -- --reset",
    );
    return;
  }
  if (RESET) await removeDemo();

  const days = weekdays(260);
  const series = Object.fromEntries(
    STOCKS.map((s) => [s.t, candlesFor(s, days)]),
  );
  const stock = Object.fromEntries(STOCKS.map((s) => [s.t, s]));
  const fxOf = (s) => (stock[s].cur === "USD" ? FX_USD : 1);
  // chiusura del giorno di borsa più vicino a "d giorni fa"
  const at = (s, d) => {
    const target = Date.now() - d * 86400000;
    const c = series[s].reduce((a, b) =>
      Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a,
    );
    return { date: iso(c.t), price: r2(c.c) };
  };

  // piano delle operazioni
  const ops = [];
  for (const o of OPS) {
    const { date, price } = at(o.s, o.d);
    ops.push({
      date,
      isin: stock[o.s].isin,
      type: o.type || "Acquisto",
      quantity: o.n,
      price,
      fx: fxOf(o.s),
      fees: 2,
      note: o.type ? "Presa di profitto" : "Acquisto",
    });
  }
  const allocPlan = ALLOCS.map((a) => {
    const buy = at(a.s, a.d);
    const entryEur = r4(buy.price * fxOf(a.s));
    const units = a.euro / entryEur;
    const cl = CLIENTS.find((c) => c.key === a.c);
    ops.push({
      date: buy.date,
      isin: stock[a.s].isin,
      type: "Acquisto",
      quantity: r4(units),
      price: buy.price,
      fx: fxOf(a.s),
      fees: 0,
      note: `Acquisto per ${cl.name}`,
    });
    let exit = null;
    if (a.closeD) {
      exit = at(a.s, a.closeD);
      ops.push({
        date: exit.date,
        isin: stock[a.s].isin,
        type: "Vendita",
        quantity: r4(units),
        price: exit.price,
        fx: fxOf(a.s),
        fees: 0,
        note: "Vendita allocazione cliente",
      });
    }
    return { ...a, buy, entryEur, exit };
  });

  // il registro deve essere coerente (nessuna vendita oltre le quote possedute)
  const { errors } = computeLedger(ops.map((o, i) => ({ ...o, id: i + 1 })));
  if (errors.length)
    throw new Error("Dati demo incoerenti: " + errors[0].error);

  const idOf = {};
  await transaction(async (tx) => {
    // clienti e utenti
    const owner = await tx.run(
      "INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)",
      [
        "demo",
        USERS.demo.name,
        await bcrypt.hash(USERS.demo.password, 10),
        "utente",
      ],
    );
    const ownerId = owner.lastID;
    for (const c of CLIENTS) {
      const r = await tx.run(
        "INSERT INTO clients (owner_id, name, email, notes, capital, default_stop_pct, max_drawdown_pct) VALUES (?,?,?,?,?,?,?)",
        [ownerId, c.name, c.email, c.notes, c.capital, c.stop, c.dd],
      );
      idOf[c.key] = r.lastID;
      if (c.login)
        await tx.run(
          "INSERT INTO users (username, name, password_hash, role, client_id) VALUES (?,?,?,?,?)",
          [
            c.login,
            c.name,
            await bcrypt.hash(USERS[c.login].password, 10),
            "cliente",
            r.lastID,
          ],
        );
    }

    // titoli con le loro soglie di alert
    for (const s of STOCKS) {
      await tx.run(
        `INSERT INTO positions (owner_id, isin, name, ticker, currency, sector, risk, max_weight, stop_price, target_price,
           min_pl_pct, day_drop_pct, rsi_low, rsi_high, next_review, dividends, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ownerId,
          s.isin,
          s.name,
          s.t,
          s.cur,
          s.sector,
          s.risk,
          s.weight,
          r2(s.base * 0.85),
          r2(s.base * 1.25),
          s.minPl ?? -10,
          5,
          30,
          70,
          s.review,
          s.t === "VWCE.DE" ? 0 : r2(s.base * 0.004 * 40),
          "Dato dimostrativo",
        ],
      );
    }
    for (const o of ops)
      await tx.run(
        "INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          ownerId,
          o.date,
          o.isin,
          o.type,
          o.quantity,
          o.price,
          o.fx,
          o.fees,
          o.note,
        ],
      );
    for (const a of allocPlan) {
      const cl = CLIENTS.find((c) => c.key === a.c);
      await tx.run(
        `INSERT INTO allocations (owner_id, client_id, isin, euro, entry_price_eur, note, stop_loss_pct, status, closed_at, exit_price_eur, exit_reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ownerId,
          idOf[a.c],
          stock[a.s].isin,
          a.euro,
          a.entryEur,
          "Allocazione demo",
          cl.stop,
          a.exit ? "closed" : "open",
          a.exit ? `${a.exit.date}T15:30:00.000Z` : null,
          a.exit ? r4(a.exit.price * fxOf(a.s)) : null,
          a.exit ? "manuale" : null,
          `${a.buy.date}T10:00:00.000Z`,
        ],
      );
    }

    // notifiche di esempio
    const mario = await tx.get(
      "SELECT id FROM users WHERE username = 'mario.rossi'",
    );
    const giulia = await tx.get(
      "SELECT id FROM users WHERE username = 'giulia.bianchi'",
    );
    const note = (u, kind, sev, title, msg) =>
      tx.run(
        "INSERT INTO notifications (user_id, kind, severity, title, message) VALUES (?,?,?,?,?)",
        [u, kind, sev, title, msg],
      );
    await note(
      ownerId,
      "info",
      "info",
      "Benvenuto nei dati demo",
      "Titoli, operazioni e clienti sono di esempio: puoi modificarli o cancellarli.",
    );
    await note(
      ownerId,
      "alert",
      "warning",
      "NVIDIA: peso oltre il massimo",
      "Il titolo supera il 12% del portafoglio impostato.",
    );
    await note(
      ownerId,
      "alert",
      "info",
      "SAP: revisione scaduta",
      "La data di revisione è passata: controlla il titolo.",
    );
    if (mario)
      await note(
        mario.id,
        "info",
        "info",
        "Nuova allocazione",
        "Il tuo gestore ha investito 1.500 € in Eni.",
      );
    if (giulia)
      await note(
        giulia.id,
        "sale",
        "info",
        "Vendita completata",
        "L'allocazione su Eni è stata venduta.",
      );

    // quotazioni di esempio nella cache: l'app funziona anche senza internet
    const now = Date.now();
    for (const s of STOCKS) {
      const cs = series[s.t];
      await tx.run(
        `INSERT OR REPLACE INTO market_cache (symbol, name, exchange, currency, price, market_time, candles, fetched_at, last_error)
         VALUES (?,?,?,?,?,?,?,?,NULL)`,
        [
          s.t,
          s.name,
          s.ex,
          s.cur,
          cs[cs.length - 1].c,
          cs[cs.length - 1].t,
          JSON.stringify(cs),
          now,
        ],
      );
    }
    await tx.run(
      "INSERT OR REPLACE INTO fx_cache (currency, eur_per_unit, fetched_at) VALUES ('USD', ?, ?)",
      [FX_USD, now],
    );
  });

  const n = await all(
    "SELECT (SELECT COUNT(*) FROM positions) p, (SELECT COUNT(*) FROM operations) o, (SELECT COUNT(*) FROM allocations) a",
  );
  console.log(`Dati demo creati in ${config.DB_FILE}`);
  console.log(
    `  ${STOCKS.length} titoli · ${ops.length} operazioni · ${ALLOCS.length} allocazioni · ${CLIENTS.length} clienti (totali nel database: ${n[0].p}/${n[0].o}/${n[0].a})`,
  );
  console.log("\nAccessi (nome utente / password):");
  for (const [u, v] of Object.entries(USERS))
    console.log(`  ${u.padEnd(15)} ${v.password.padEnd(12)} ${v.role}`);
  console.log("\nAvvia l'app con: npm start");
}

main()
  .catch((e) => {
    console.error("Seed non riuscito:", e.message);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 50));
