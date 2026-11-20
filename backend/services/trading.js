// Acquisti e vendite a prezzo di mercato reale, capitale dei clienti e vendita forzata.
//  - buy: compra un titolo al prezzo attuale (API) per un cliente, per importo in euro o per numero di quote: registra l'operazione, assegna l'importo e controlla il capitale
//  - closeAllocation / sellAllocation / sellPosition: vendono al prezzo attuale (tutta l'allocazione, una parte per quote o importo, quote libere)
//  - runRisk: stop loss per allocazione e perdita massima sul capitale del cliente => vendita forzata automatica
const { get, all, run, transaction } = require("../db/database");
const market = require("./market");
const {
  loadPortfolio,
  computeLedger,
  clientHoldings,
  clientTotals,
} = require("./portfolio");
const { notifyClient, notifyUser } = require("./notify");
const { CATALOG } = require("./catalog");
const { HttpError, bad, blank, sizeFrom } = require("../routes/helpers");

const EPS = 1e-8;
const MIN_EUR = 0.01; // importo minimo di un ordine (e resto minimo che ha senso tenere in un'allocazione)
const today = () => new Date().toISOString().slice(0, 10);
const fmtEur = (n) =>
  `${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtQty = (n) =>
  Number(n).toLocaleString("it-IT", { maximumFractionDigits: 4 });
const fmtPct = (n) =>
  `${n > 0 ? "+" : ""}${Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// Incasso di un'allocazione chiusa: quote x prezzo di uscita
function proceeds(a) {
  const entry = a.entry_price_eur > 0 ? a.entry_price_eur : null;
  return entry && a.exit_price_eur > 0
    ? (a.euro / entry) * a.exit_price_eur
    : a.euro;
}
// Liquidita' del cliente = capitale - tutto cio' che e' stato assegnato + incassi delle allocazioni chiuse
function cashOf(client, allocs) {
  return (
    (client.capital || 0) -
    allocs.reduce((s, a) => s + a.euro, 0) +
    allocs
      .filter((a) => a.status === "closed")
      .reduce((s, a) => s + proceeds(a), 0)
  );
}
async function clientCash(clientId) {
  const client = await get("SELECT * FROM clients WHERE id = ?", [clientId]);
  const allocs = await all("SELECT * FROM allocations WHERE client_id = ?", [
    clientId,
  ]);
  return { client, cash: cashOf(client, allocs) };
}

function checkStop(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 100)
    throw bad("Stop loss %: deve essere tra 0 e 100");
  return n;
}

// Prezzo e cambio freschi: se l'API non risponde non si negozia a un prezzo vecchio.
async function livePrice(ticker, currency) {
  let d;
  try {
    d = await market.getSymbolData(ticker, { force: true });
  } catch (e) {
    throw new HttpError(
      502,
      `Quotazione non disponibile per ${ticker}: ${e.message}`,
    );
  }
  if (d.stale || !(d.price > 0))
    throw new HttpError(
      502,
      `Prezzo di ${ticker} non aggiornato (API non raggiungibile): operazione bloccata.`,
    );
  const cur = currency || d.currency;
  if (currency && currency !== d.currency)
    throw bad(
      `Valuta del titolo (${currency}) diversa dalla quotazione (${d.currency}): correggi il titolo`,
    );
  const fx = await market.getFx(cur);
  if (!(fx.rate > 0))
    throw new HttpError(
      502,
      `Cambio ${cur}/EUR non disponibile: operazione bloccata.`,
    );
  return { d, fx: fx.rate, priceEur: d.price * fx.rate };
}

async function positionQty(ownerId, isin) {
  const ops = await all("SELECT * FROM operations WHERE owner_id = ?", [
    ownerId,
  ]);
  const s = computeLedger(ops).state.get(isin);
  return s ? s.qty : 0;
}

// ---- Acquisto per un cliente (o per il solo portafoglio) --------------------------------------------
// Si indica o l'importo in euro oppure il numero di quote. Controlli: capitale impostato, importo/quote > 0,
// importo minimo, e se c'e' un cliente non si puo' spendere piu' della sua liquidita'.
async function buy({
  ownerId,
  symbol,
  euro,
  quantity,
  clientId,
  stopLossPct,
  note,
  actorId,
}) {
  symbol = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol) throw bad("Scegli un titolo");
  const size = sizeFrom({ euro, quantity });

  let client = null;
  if (clientId) {
    client = await get("SELECT * FROM clients WHERE id = ? AND owner_id = ?", [
      parseInt(clientId, 10),
      ownerId,
    ]);
    if (!client) throw new HttpError(404, "Cliente non trovato");
    if (!(client.capital > 0))
      throw bad(
        `Imposta prima il capitale di ${client.name} (scheda cliente > Modifica)`,
      );
  }
  const stop =
    stopLossPct === "" || stopLossPct == null
      ? client
        ? client.default_stop_pct
        : null
      : checkStop(stopLossPct);

  const existing = await get(
    "SELECT * FROM positions WHERE owner_id = ? AND (UPPER(ticker) = ? OR UPPER(isin) = ?)",
    [ownerId, symbol, symbol],
  );
  const { d, fx, priceEur } = await livePrice(
    existing && existing.ticker ? existing.ticker : symbol,
    existing ? existing.currency : null,
  );
  // Il numero di quote e l'importo si ricavano uno dall'altro al prezzo reale del momento
  const qty = size.quantity != null ? size.quantity : size.euro / priceEur;
  euro = size.euro != null ? size.euro : size.quantity * priceEur;
  if (euro < MIN_EUR)
    throw bad(
      `Ordine troppo piccolo: minimo ${fmtEur(MIN_EUR)} (richiesti ${fmtEur(euro)})`,
    );
  if (client) {
    const cash = cashOf(
      client,
      await all("SELECT * FROM allocations WHERE client_id = ?", [client.id]),
    );
    if (euro > cash + 0.005) {
      throw bad(
        `Capitale insufficiente: ${client.name} puo' investire ancora ${fmtEur(Math.max(0, cash))} (≈ ${fmtQty(Math.max(0, cash) / priceEur)} quote), richiesti ${fmtEur(euro)} (${fmtQty(qty)} quote)`,
      );
    }
  }
  const cat = CATALOG.find((c) => c.symbol === symbol);

  const out = await transaction(async (tx) => {
    let pos = existing;
    if (!pos) {
      await tx.run(
        "INSERT INTO positions (owner_id, isin, name, ticker, currency, sector) VALUES (?,?,?,?,?,?)",
        [
          ownerId,
          symbol,
          d.name || symbol,
          symbol,
          d.currency,
          cat ? cat.sector : null,
        ],
      );
      pos = await tx.get(
        "SELECT * FROM positions WHERE owner_id = ? AND isin = ?",
        [ownerId, symbol],
      );
    }
    await tx.run(
      "INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        ownerId,
        today(),
        pos.isin,
        "Acquisto",
        qty,
        d.price,
        fx,
        0,
        note || (client ? `Acquisto per ${client.name}` : "Acquisto a mercato"),
      ],
    );
    let allocationId = null;
    if (client) {
      const r = await tx.run(
        "INSERT INTO allocations (owner_id, client_id, isin, euro, entry_price_eur, note, stop_loss_pct) VALUES (?,?,?,?,?,?,?)",
        [ownerId, client.id, pos.isin, euro, priceEur, note || null, stop],
      );
      allocationId = r.lastID;
    }
    return { pos, allocationId };
  });

  const text = `${fmtEur(euro)} su ${out.pos.name} a ${d.price.toLocaleString("it-IT", { maximumFractionDigits: 4 })} ${d.currency} (${qty.toLocaleString("it-IT", { maximumFractionDigits: 4 })} quote)`;
  if (client) {
    await notifyClient(client.id, {
      kind: "buy",
      severity: "success",
      title: `Nuovo acquisto: ${out.pos.name}`,
      message: `Sono stati investiti ${text}.${stop ? ` Stop loss al -${stop}%.` : ""}`,
    });
  }
  if (actorId && actorId !== ownerId)
    await notifyUser(ownerId, {
      kind: "buy",
      severity: "info",
      title: `Acquisto registrato: ${out.pos.name}`,
      message: text,
    });
  return {
    positionId: out.pos.id,
    isin: out.pos.isin,
    name: out.pos.name,
    quantity: qty,
    price: d.price,
    currency: d.currency,
    fx,
    priceEur,
    euro,
    allocationId: out.allocationId,
    stopLossPct: stop,
  };
}

// ---- Chiusura di un'allocazione (manuale o forzata) -------------------------------------------------
async function closeAllocation(
  id,
  { reason = "manuale", ownerId = null } = {},
) {
  const a = await get(
    "SELECT * FROM allocations WHERE id = ? AND status = 'open'",
    [id],
  );
  if (!a || (ownerId && a.owner_id !== ownerId))
    throw new HttpError(404, "Allocazione aperta non trovata");
  const pos = await get(
    "SELECT * FROM positions WHERE owner_id = ? AND isin = ?",
    [a.owner_id, a.isin],
  );
  if (!pos || !pos.ticker)
    throw bad("Titolo senza ticker: impossibile vendere a prezzo di mercato");
  const entry = a.entry_price_eur > 0 ? a.entry_price_eur : null;
  if (!entry)
    throw bad(
      "Allocazione senza prezzo di ingresso: indicalo con Modifica prima di venderla",
    );
  const { d, fx, priceEur } = await livePrice(pos.ticker, pos.currency);
  const units = a.euro / entry;
  const have = await positionQty(a.owner_id, a.isin);
  const sellQty = Math.min(units, have);

  await transaction(async (tx) => {
    if (sellQty > EPS) {
      await tx.run(
        "INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          a.owner_id,
          today(),
          a.isin,
          "Vendita",
          sellQty,
          d.price,
          fx,
          0,
          reason === "manuale"
            ? "Vendita allocazione cliente"
            : `Vendita forzata (${reason})`,
        ],
      );
    }
    await tx.run(
      "UPDATE allocations SET status = 'closed', closed_at = ?, exit_price_eur = ?, exit_reason = ? WHERE id = ?",
      [new Date().toISOString(), priceEur, reason, a.id],
    );
  });

  const incasso = units * priceEur,
    pnl = incasso - a.euro,
    pnlPct = (incasso / a.euro - 1) * 100;
  const forced = reason !== "manuale";
  const why =
    reason === "stop_loss"
      ? `Stop loss raggiunto (-${a.stop_loss_pct}%).`
      : reason === "drawdown"
        ? "Perdita massima sul capitale raggiunta."
        : "";
  const note = {
    kind: forced ? "forced_sale" : "sale",
    severity: forced ? "danger" : "info",
    title: `${forced ? "Vendita forzata" : "Vendita"}: ${pos.name}`,
    message:
      `${why} Incassati ${fmtEur(incasso)} (${pnl >= 0 ? "+" : ""}${fmtEur(pnl)}, ${fmtPct(pnlPct)}) a ${d.price.toLocaleString("it-IT", { maximumFractionDigits: 4 })} ${d.currency}.`.trim(),
  };
  await notifyClient(a.client_id, note);
  await notifyUser(a.owner_id, {
    ...note,
    title: `${note.title} (cliente #${a.client_id})`,
  });
  return { id: a.id, proceeds: incasso, pnl, pnlPct, reason, priceEur };
}

// ---- Vendita PARZIALE di un'allocazione cliente: numero di quote oppure importo in euro -------------------
// Controlli: l'allocazione deve essere aperta, non si vende piu' di quanto il cliente ha (quote o valore attuale),
// importo minimo; se il resto sarebbe trascurabile (< 0,01 €) o si chiede tutto, si vende l'intera allocazione.
// L'allocazione resta aperta con le quote rimaste; la parte venduta diventa una riga "chiusa" (incasso in liquidita').
async function sellAllocation(
  id,
  { ownerId = null, euro = null, quantity = null, all: sellAll = false } = {},
) {
  if (sellAll || (blank(euro) && blank(quantity)))
    return closeAllocation(id, { reason: "manuale", ownerId });
  const size = sizeFrom({ euro, quantity });
  const a = await get(
    "SELECT * FROM allocations WHERE id = ? AND status = 'open'",
    [id],
  );
  if (!a || (ownerId && a.owner_id !== ownerId))
    throw new HttpError(404, "Allocazione aperta non trovata");
  const pos = await get(
    "SELECT * FROM positions WHERE owner_id = ? AND isin = ?",
    [a.owner_id, a.isin],
  );
  if (!pos || !pos.ticker)
    throw bad("Titolo senza ticker: impossibile vendere a prezzo di mercato");
  const entry = a.entry_price_eur > 0 ? a.entry_price_eur : null;
  if (!entry)
    throw bad(
      "Allocazione senza prezzo di ingresso: indicalo con Modifica prima di venderla",
    );

  const { d, fx, priceEur } = await livePrice(pos.ticker, pos.currency);
  const units = a.euro / entry; // quote del cliente in questa allocazione
  const maxEuro = units * priceEur; // quanto incasserebbe vendendo tutto adesso
  const q = size.quantity != null ? size.quantity : size.euro / priceEur;
  if (size.quantity != null && q > units + EPS)
    throw bad(
      `Quote da vendere (${fmtQty(q)}) oltre quelle dell'allocazione: al massimo ${fmtQty(units)} quote`,
    );
  if (size.euro != null && size.euro > maxEuro + 0.005)
    throw bad(
      `Importo da vendere (${fmtEur(size.euro)}) oltre il valore dell'allocazione: al massimo ${fmtEur(maxEuro)}`,
    );
  if (q * priceEur < MIN_EUR)
    throw bad(`Vendita troppo piccola: minimo ${fmtEur(MIN_EUR)}`);
  const rest = units - q;
  if (rest * priceEur < MIN_EUR)
    return closeAllocation(id, { reason: "manuale", ownerId }); // nulla di sensato rimarrebbe: si vende tutto

  const sellQty = Math.min(q, await positionQty(a.owner_id, a.isin));
  const costPart = q * entry; // parte dell'importo investito che esce
  const note = `${a.note ? a.note + " · " : ""}vendita parziale`.slice(0, 300);
  let soldId = null;
  await transaction(async (tx) => {
    if (sellQty > EPS) {
      await tx.run(
        "INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          a.owner_id,
          today(),
          a.isin,
          "Vendita",
          sellQty,
          d.price,
          fx,
          0,
          "Vendita parziale allocazione cliente",
        ],
      );
    }
    await tx.run("UPDATE allocations SET euro = ? WHERE id = ?", [
      a.euro - costPart,
      a.id,
    ]);
    const r = await tx.run(
      "INSERT INTO allocations (owner_id, client_id, isin, euro, entry_price_eur, note, stop_loss_pct, status, closed_at, exit_price_eur, exit_reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        a.owner_id,
        a.client_id,
        a.isin,
        costPart,
        entry,
        note,
        a.stop_loss_pct,
        "closed",
        new Date().toISOString(),
        priceEur,
        "manuale",
        a.created_at,
      ],
    );
    soldId = r.lastID;
  });

  const incasso = q * priceEur,
    pnl = incasso - costPart,
    pnlPct = (incasso / costPart - 1) * 100;
  const msg = {
    kind: "sale",
    severity: "info",
    title: `Vendita parziale: ${pos.name}`,
    message: `Vendute ${fmtQty(q)} quote a ${d.price.toLocaleString("it-IT", { maximumFractionDigits: 4 })} ${d.currency}: incassati ${fmtEur(incasso)} (${pnl >= 0 ? "+" : ""}${fmtEur(pnl)}, ${fmtPct(pnlPct)}). Restano ${fmtQty(rest)} quote.`,
  };
  await notifyClient(a.client_id, msg);
  await notifyUser(a.owner_id, {
    ...msg,
    title: `${msg.title} (cliente #${a.client_id})`,
  });
  return {
    id: a.id,
    soldAllocationId: soldId,
    partial: true,
    quantity: q,
    proceeds: incasso,
    pnl,
    pnlPct,
    reason: "manuale",
    priceEur,
    remainingUnits: rest,
    remainingEuro: a.euro - costPart,
  };
}

// ---- Vendita di quote del portafoglio non assegnate ai clienti (per numero di quote, per importo o tutte) ----
async function sellPosition({
  ownerId,
  positionId,
  quantity,
  euro,
  all: sellAll,
}) {
  const pos = await get(
    "SELECT * FROM positions WHERE id = ? AND owner_id = ?",
    [positionId, ownerId],
  );
  if (!pos) throw new HttpError(404, "Posizione non trovata");
  if (!pos.ticker)
    throw bad("Titolo senza ticker: impossibile vendere a prezzo di mercato");
  const qty = await positionQty(ownerId, pos.isin);
  const allocs = await all(
    "SELECT * FROM allocations WHERE owner_id = ? AND isin = ? AND status = 'open'",
    [ownerId, pos.isin],
  );
  const allocated = allocs.reduce(
    (s, a) => s + (a.entry_price_eur > 0 ? a.euro / a.entry_price_eur : 0),
    0,
  );
  const free = Math.max(0, qty - allocated);
  if (free <= EPS)
    throw bad(
      "Nessuna quota libera: tutto il resto e' assegnato ai clienti (vendi prima le loro allocazioni)",
    );
  const size = sizeFrom({ quantity, euro, all: sellAll }, { allowAll: true });
  if (size.quantity != null && size.quantity > free + EPS)
    throw bad(
      `Puoi vendere al massimo ${fmtQty(free)} quote libere: le altre sono assegnate ai clienti`,
    );
  const { d, fx, priceEur } = await livePrice(pos.ticker, pos.currency);
  const q = size.all
    ? free
    : size.quantity != null
      ? size.quantity
      : size.euro / priceEur;
  if (q > free + EPS)
    throw bad(
      `Importo da vendere (${fmtEur(size.euro)}) oltre il valore delle quote libere: al massimo ${fmtEur(free * priceEur)}`,
    );
  if (q * priceEur < MIN_EUR)
    throw bad(`Vendita troppo piccola: minimo ${fmtEur(MIN_EUR)}`);
  await run(
    "INSERT INTO operations (owner_id, date, isin, type, quantity, price, fx, fees, note) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      ownerId,
      today(),
      pos.isin,
      "Vendita",
      Math.min(q, qty),
      d.price,
      fx,
      0,
      "Vendita a mercato",
    ],
  );
  return {
    quantity: q,
    price: d.price,
    currency: d.currency,
    fx,
    amountEur: q * d.price * fx,
  };
}

// ---- Controllo rischio: vendita forzata ------------------------------------------------------------------
async function runRisk(ownerId) {
  const open = await all(
    "SELECT * FROM allocations WHERE owner_id = ? AND status = 'open'",
    [ownerId],
  );
  if (!open.length) return [];
  const pf = await loadPortfolio(ownerId);
  const byIsin = new Map(pf.positions.map((p) => [p.isin, p]));
  const closed = [];
  const tryClose = async (id, reason) => {
    try {
      closed.push(await closeAllocation(id, { reason }));
    } catch (e) {
      console.warn(
        `[rischio] vendita forzata ${id} non eseguita: ${e.message}`,
      );
    }
  };

  // 1) Stop loss per singola allocazione (solo con prezzo reale aggiornato, mai con prezzi manuali o datati)
  for (const a of open) {
    const p = byIsin.get(a.isin);
    if (
      !(a.stop_loss_pct > 0) ||
      !(a.entry_price_eur > 0) ||
      !p ||
      p.priceSource !== "api" ||
      p.price == null ||
      p.fx == null
    )
      continue;
    const pnlPct = ((p.price * p.fx) / a.entry_price_eur - 1) * 100;
    if (pnlPct <= -a.stop_loss_pct) await tryClose(a.id, "stop_loss");
  }

  // 2) Perdita massima sul capitale del cliente: si vende tutto
  const clients = await all(
    "SELECT * FROM clients WHERE owner_id = ? AND max_drawdown_pct > 0 AND capital > 0",
    [ownerId],
  );
  for (const c of clients) {
    const allocs = await all("SELECT * FROM allocations WHERE client_id = ?", [
      c.id,
    ]);
    const stillOpen = allocs.filter((a) => a.status === "open");
    if (!stillOpen.length) continue;
    const holdings = clientHoldings(allocs, pf.positions);
    const open2 = holdings.filter((h) => h.status === "open");
    if (open2.some((h) => h.value == null)) continue; // senza prezzi completi non si decide
    const t = clientTotals(c, holdings);
    if (
      t.equity != null &&
      t.equity <= c.capital * (1 - c.max_drawdown_pct / 100)
    ) {
      for (const a of stillOpen) await tryClose(a.id, "drawdown");
    }
  }
  return closed;
}

module.exports = {
  buy,
  closeAllocation,
  sellAllocation,
  sellPosition,
  runRisk,
  cashOf,
  clientCash,
  checkStop,
  proceeds,
};
