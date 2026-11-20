const test = require("node:test");
const assert = require("node:assert/strict");
const ind = require("../services/indicators");
const { computeLedger, validateOperation } = require("../services/portfolio");
const { evaluateAlerts } = require("../services/alerts");

test("SMA e EMA", () => {
  assert.deepEqual(ind.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = ind.ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2);
  assert.equal(e[3], 3);
  assert.equal(e[4], 4);
});

test("RSI: serie sempre crescente = 100, sempre calante = 0, sempre in 0..100", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(ind.rsi(up).at(-1), 100);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(ind.rsi(down).at(-1), 0);
  const noisy = Array.from(
    { length: 80 },
    (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1,
  );
  for (const v of ind.rsi(noisy).filter((x) => x != null))
    assert.ok(v >= 0 && v <= 100);
});

test("RSI di Wilder: valore calcolato a mano", () => {
  // 14 variazioni: 8 rialzi da +1, 6 ribassi da -1 -> gain medio 8/14, loss medio 6/14, RSI = 100-100/(1+8/6)
  const v = [100];
  for (let i = 0; i < 8; i++) v.push(v.at(-1) + 1);
  for (let i = 0; i < 6; i++) v.push(v.at(-1) - 1);
  assert.ok(Math.abs(ind.rsi(v, 14)[14] - (100 - 100 / (1 + 8 / 6))) < 1e-9);
});

test("Bollinger, MACD, drawdown, volatilita", () => {
  const flat = new Array(30).fill(10);
  const bb = ind.bollinger(flat, 20);
  assert.equal(bb.upper[25], 10);
  assert.equal(bb.lower[25], 10);
  const m = ind.macd(Array.from({ length: 60 }, (_, i) => 100 + i));
  assert.ok(m.line.at(-1) > 0);
  assert.ok(Math.abs(ind.maxDrawdown([100, 120, 90, 110]) - -25) < 1e-9);
  assert.equal(
    Math.round(ind.annualizedVolatility(new Array(10).fill(5)) * 1000) / 1000,
    0,
  );
});

const op = (
  id,
  date,
  type,
  quantity,
  price,
  fx = 1,
  fees = 0,
  isin = "IT1",
) => ({ id, date, isin, type, quantity, price, fx, fees });

test("Registro: esempio della guida (20 a 533,8395 + 20 a 530,14 = 531,98975)", () => {
  const { state, errors } = computeLedger([
    op(1, "2025-01-10", "Acquisto", 20, 533.8395),
    op(2, "2025-02-10", "Acquisto", 20, 530.14),
  ]);
  assert.equal(errors.length, 0);
  const s = state.get("IT1");
  assert.ok(Math.abs(s.cost / s.qty - 531.98975) < 1e-9);
});

test("Registro: vendita parziale mantiene il prezzo medio e calcola il realizzato", () => {
  const { state } = computeLedger([
    op(1, "2025-01-01", "Acquisto", 10, 100, 1, 5),
    op(2, "2025-02-01", "Vendita", 4, 150, 1, 2),
  ]);
  const s = state.get("IT1");
  // costo 1005, medio 100.5; vendita netta 600-2=598; costo venduto 402 -> realizzato 196
  assert.ok(Math.abs(s.realized - 196) < 1e-9);
  assert.equal(s.qty, 6);
  assert.ok(Math.abs(s.cost / s.qty - 100.5) < 1e-9);
});

test("Registro: cambio, ordine cronologico e vendita oltre saldo", () => {
  const a = computeLedger([
    op(2, "2025-03-01", "Vendita", 5, 10),
    op(1, "2025-01-01", "Acquisto", 5, 10, 0.9),
  ]);
  assert.equal(a.errors.length, 0);
  assert.equal(a.state.get("IT1").qty, 0);
  const b = computeLedger([
    op(1, "2025-01-01", "Acquisto", 5, 10),
    op(2, "2025-01-02", "Vendita", 6, 10),
  ]);
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0].error, /oltre saldo/);
});

test("Validazione operazioni", () => {
  const ok = op(1, "2025-01-01", "Acquisto", 1, 1);
  assert.equal(validateOperation(ok), null);
  assert.ok(validateOperation({ ...ok, quantity: 0 }));
  assert.ok(validateOperation({ ...ok, date: "2025-02-30" }));
  assert.ok(validateOperation({ ...ok, date: "2999-01-01" }));
  assert.ok(validateOperation({ ...ok, type: "Dividendo" }));
  assert.ok(validateOperation({ ...ok, fees: -1 }));
  assert.ok(validateOperation({ ...ok, isin: "" }));
});

const pos = (o) => ({
  hasOperations: true,
  quantity: 10,
  cost: 1000,
  price: 90,
  fx: 1,
  currency: "EUR",
  value: 900,
  pnlPct: -10,
  weight: 50,
  allocatedEur: 0,
  priceSource: "api",
  quoteTime: Date.now(),
  dayChangePct: -6,
  ...o,
});
const codes = (p, a) =>
  evaluateAlerts(p, { today: "2026-11-14", analysis: a }).map((x) => x.code);

test("Alert: stop, obiettivo, soglie utente, peso, revisione", () => {
  assert.ok(codes(pos({ stopPrice: 90 })).includes("stop"));
  assert.ok(codes(pos({ stopPrice: 88 })).includes("near_stop"));
  assert.ok(!codes(pos({ stopPrice: 50 })).includes("stop"));
  assert.ok(codes(pos({ targetPrice: 80 })).includes("target"));
  assert.ok(codes(pos({ minValueEur: 1000 })).includes("min_value"));
  assert.ok(!codes(pos({ minValueEur: 500 })).includes("min_value"));
  assert.ok(codes(pos({ minPlPct: -5 })).includes("min_pl"));
  assert.ok(!codes(pos({ minPlPct: -15 })).includes("min_pl"));
  assert.ok(codes(pos({ dayDropPct: 5 })).includes("day_drop"));
  assert.ok(codes(pos({ maxWeight: 40 })).includes("overweight"));
  assert.ok(codes(pos({ nextReview: "2026-11-14" })).includes("review"));
  assert.ok(!codes(pos({ nextReview: "2026-11-15" })).includes("review"));
  assert.ok(codes(pos({ allocatedEur: 1500 })).includes("over_allocated"));
});

test("Alert: quotazione mancante, posizione chiusa", () => {
  assert.deepEqual(codes(pos({ price: null, value: null })), ["quote_missing"]);
  assert.deepEqual(codes(pos({ quantity: 0 })), ["closed"]);
});

const { sizeFrom } = require("../routes/helpers");

test("Quanto comprare/vendere: importo OPPURE quote, mai entrambi, sempre > 0", () => {
  assert.deepEqual(sizeFrom({ euro: "250.5" }), {
    euro: 250.5,
    quantity: null,
    all: false,
  });
  assert.deepEqual(sizeFrom({ quantity: 3, euro: "" }), {
    euro: null,
    quantity: 3,
    all: false,
  });
  assert.throws(() => sizeFrom({ euro: 10, quantity: 2 }), /non tutti e due/); // entrambi
  assert.throws(() => sizeFrom({}), /Indica quanto comprare/); // nessuno
  assert.throws(
    () => sizeFrom({}, { allowAll: true }),
    /Indica quanto vendere/,
  );
  assert.throws(() => sizeFrom({ euro: 0 }), /maggiore di 0/); // zero
  assert.throws(() => sizeFrom({ quantity: -1 }), /maggiore di 0/); // negativo
  assert.throws(() => sizeFrom({ euro: "abc" }), /non valido/); // non numerico
  assert.deepEqual(sizeFrom({ all: true, euro: 5 }, { allowAll: true }), {
    euro: null,
    quantity: null,
    all: true,
  });
  assert.throws(() => sizeFrom({ all: true }), /Indica quanto comprare/); // "tutto" vale solo per le vendite
});
