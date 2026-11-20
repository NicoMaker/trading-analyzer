// Acquisto e vendita a prezzo di mercato reale. Per l'admin: si sceglie il portafoglio dell'utente in cui operare.
// Si puo' indicare QUANTO in tre modi: importo in euro, numero di quote, oppure (solo vendite) tutto.
import { h, eur, num, pct, mount } from "../utils.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { modal, toast, field, input, select, errorBox, badge } from "./ui.js";
import { openSearch } from "./search.js";

const MODE_LABEL = {
  euro: "Importo in €",
  quantity: "Numero di quote",
  all: "Tutto",
};
const EPS = 1e-8;

// Campo "quanto": importo in euro oppure numero di quote (e "tutto" per le vendite).
//  getPrice() -> prezzo in € di una quota (o null)
//  getMax()   -> { units, euro, exact } massimo consentito (o null): serve per l'anteprima, il pulsante Max e l'avviso se si supera
// L'avviso e' solo un aiuto: i controlli veri sono sempre quelli del server.
export function sizeField({
  modes = ["euro", "quantity"],
  getPrice,
  getMax,
  onChange,
}) {
  const mode = h(
    "select",
    { name: "mode", "aria-label": "Come indicare la quantità" },
    modes.map((m) => h("option", { value: m }, MODE_LABEL[m])),
  );
  const euroIn = input("euro", {
    type: "number",
    step: "0.01",
    min: 0.01,
    placeholder: "es. 500",
  });
  const qtyIn = input("quantity", {
    type: "number",
    step: "any",
    min: 0,
    placeholder: "es. 2,5",
  });
  const maxBtn = h("button", { type: "button", class: "btn sm" }, "Max");
  const euroBox = h(
    "div",
    { class: "stack" },
    field("Importo in euro", euroIn),
  );
  const qtyBox = h(
    "div",
    { class: "stack" },
    field("Numero di quote", qtyIn, "Anche frazionarie (es. 2,5)"),
  );
  const info = h("div", { class: "preview hidden" });
  const parse = (el) => {
    const v = parseFloat(el.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  function state() {
    const price = getPrice ? getPrice() : null,
      max = getMax ? getMax() : null;
    let units = null,
      euroV = null;
    if (mode.value === "all") {
      units = max ? max.units : null;
      euroV =
        max && max.euro != null
          ? max.euro
          : price && units != null
            ? units * price
            : null;
    } else if (mode.value === "euro") {
      euroV = parse(euroIn);
      units = euroV != null && price ? euroV / price : null;
    } else {
      units = parse(qtyIn);
      euroV = units != null && price ? units * price : null;
    }
    const over =
      !!max &&
      ((units != null && max.units != null && units > max.units + EPS) ||
        (euroV != null && max.euro != null && euroV > max.euro + 0.005));
    return { price, max, units, euroV, over };
  }
  function refresh() {
    const s = state();
    euroBox.classList.toggle("hidden", mode.value !== "euro");
    qtyBox.classList.toggle("hidden", mode.value !== "quantity");
    maxBtn.classList.toggle("hidden", mode.value === "all" || !s.max);
    if (s.units == null && s.euroV == null) info.classList.add("hidden");
    else {
      info.classList.remove("hidden");
      const lim = s.max
        ? [
            s.max.units != null && `${num(s.max.units, 4)} quote`,
            s.max.euro != null && eur(s.max.euro),
          ]
            .filter(Boolean)
            .join(" = ")
        : "";
      info.textContent = `${s.units != null ? `≈ ${num(s.units, 4)} quote` : ""}${s.units != null && s.euroV != null ? " · " : ""}${s.euroV != null ? eur(s.euroV) : ""}${s.price ? ` a ${num(s.price, 4)} € per quota` : ""}${s.over ? ` — SUPERA il massimo (${lim})` : s.max && lim ? ` · massimo ${lim}` : ""}`;
    }
    info.style.color = s.over ? "var(--down)" : "";
    onChange && onChange(s);
  }
  maxBtn.addEventListener("click", () => {
    const max = getMax ? getMax() : null;
    if (!max) return;
    if (mode.value === "euro" && max.euro != null)
      euroIn.value = String(Math.floor(max.euro * 100) / 100);
    else if (mode.value === "quantity" && max.units != null)
      qtyIn.value = String(
        max.exact ? max.units : Math.floor(max.units * 1e4) / 1e4,
      );
    refresh();
  });
  for (const el of [mode, euroIn, qtyIn]) el.addEventListener("input", refresh);
  mode.addEventListener("change", () => {
    refresh();
    (mode.value === "euro"
      ? euroIn
      : mode.value === "quantity"
        ? qtyIn
        : mode
    ).focus();
  });

  const el = h(
    "div",
    { class: "stack", style: { gap: "10px" } },
    field("Come vuoi indicarlo", mode),
    euroBox,
    qtyBox,
    h("div", {}, maxBtn),
    info,
  );
  refresh();
  return {
    el,
    refresh,
    read: () => ({
      all: mode.value === "all",
      euro: mode.value === "euro" ? euroIn.value : "",
      quantity: mode.value === "quantity" ? qtyIn.value : "",
    }),
  };
}

// preset: { clientId, symbol }
export async function openBuyModal(preset = {}, onDone) {
  const m = modal("Compra titolo");
  let picked = null,
    clients = [];

  const ownerSel =
    store.user.role === "admin"
      ? select(
          "owner",
          store.owners.map((o) => [o.id, `${o.name} (${o.username})`]),
          store.ownerId,
        )
      : null;
  const pickedBox = h(
    "div",
    { class: "picked" },
    h("span", { class: "muted" }, "Nessun titolo scelto"),
  );
  const clientSel = h("select", { name: "clientId" });
  const stopIn = input("stopLossPct", {
    type: "number",
    step: "any",
    min: 0,
    max: 99,
    placeholder: "vuoto = standard del cliente",
  });
  const hint = h("div", { class: "muted", style: { fontSize: "12px" } });
  const errBox = h("div", { class: "form-error hidden", role: "alert" });
  const submit = h(
    "button",
    { class: "btn primary", type: "submit" },
    "Compra al prezzo attuale",
  );

  const cur = () => clients.find((c) => String(c.id) === clientSel.value);
  // Con un cliente il massimo e' la sua liquidita' (in euro e in quote al prezzo attuale)
  const size = sizeField({
    modes: ["euro", "quantity"],
    getPrice: () => (picked && picked.priceEur) || null,
    getMax: () => {
      const c = cur();
      if (!c) return null;
      const cash = Math.max(0, c.cash);
      return {
        euro: cash,
        units: picked && picked.priceEur ? cash / picked.priceEur : null,
      };
    },
  });
  const update = () => {
    const c = cur();
    hint.textContent = c
      ? `Capitale ${eur(c.capital)} · puo' ancora investire ${eur(c.cash)}${c.defaultStopPct ? ` · stop standard -${c.defaultStopPct}%` : ""}`
      : "Senza cliente: l'acquisto va solo nel portafoglio (nessun limite di capitale).";
    if (c && !stopIn.value)
      stopIn.placeholder = c.defaultStopPct
        ? `standard: ${c.defaultStopPct}`
        : "nessuno";
    size.refresh();
  };
  const loadClients = async () => {
    try {
      clients = await api.get("/clients");
    } catch (e) {
      clients = [];
      errBox.textContent = e.message;
      errBox.classList.remove("hidden");
    }
    clientSel.replaceChildren(
      h("option", { value: "" }, "— Solo portafoglio (nessun cliente) —"),
      ...clients.map((c) =>
        h(
          "option",
          { value: c.id, selected: String(c.id) === String(preset.clientId) },
          `${c.name} · liquidità ${eur(c.cash)}`,
        ),
      ),
    );
    update();
  };
  const setPicked = async (r) => {
    picked = { symbol: r.symbol, name: r.name };
    mount(
      pickedBox,
      h("b", {}, r.symbol),
      h("span", {}, r.name),
      h("span", { class: "muted" }, "prezzo in aggiornamento…"),
    );
    try {
      const q = await api.get(
        `/market/quote/${encodeURIComponent(r.symbol)}?force=1`,
      );
      picked = {
        symbol: r.symbol,
        name: q.name || r.name,
        price: q.price,
        currency: q.currency,
        priceEur: q.fxEur ? q.price * q.fxEur : null,
        stale: q.stale,
      };
      mount(
        pickedBox,
        h("b", {}, r.symbol),
        h("span", {}, picked.name),
        h("span", { class: "spacer" }),
        h("b", {}, `${num(q.price)} ${q.currency}`),
        picked.priceEur &&
          q.currency !== "EUR" &&
          h("span", { class: "muted" }, `= ${num(picked.priceEur, 4)} €`),
        q.stale &&
          badge(
            "datato",
            "warning",
            "API non raggiungibile: acquisto bloccato finche' il prezzo non e' aggiornato",
          ),
      );
    } catch (e) {
      picked = null;
      mount(
        pickedBox,
        h("span", { class: "down" }, `${r.symbol}: ${e.message}`),
      );
    }
    update();
  };

  const chooseBtn = h(
    "button",
    { type: "button", class: "btn sm", onclick: () => openSearch(setPicked) },
    "🔍 Scegli titolo",
  );

  const form = h(
    "form",
    {
      class: "stack",
      style: { gap: "14px" },
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.classList.add("hidden");
        if (!picked) {
          errBox.textContent = "Scegli prima un titolo";
          errBox.classList.remove("hidden");
          return;
        }
        submit.disabled = true;
        try {
          const sz = size.read();
          const r = await api.post("/trade/buy", {
            symbol: picked.symbol,
            euro: sz.euro,
            quantity: sz.quantity,
            clientId: clientSel.value || null,
            stopLossPct: stopIn.value,
          });
          m.close();
          toast(
            "Acquisto eseguito",
            `${num(r.quantity, 4)} quote = ${eur(r.euro)} su ${r.name} a ${num(r.price)} ${r.currency}${clientSel.value ? " · cliente avvisato" : ""}`,
            "success",
          );
          onDone && onDone(r);
        } catch (ex) {
          errBox.textContent = ex.message;
          errBox.classList.remove("hidden");
          errBox.scrollIntoView({ block: "nearest" });
        } finally {
          submit.disabled = false;
        }
      },
    },
    errBox,
    ownerSel &&
      field(
        "Portafoglio di (piattaforma dell'utente)",
        ownerSel,
        "Cambia utente per comprare nel suo portafoglio",
      ),
    h(
      "div",
      { class: "field" },
      h("label", {}, "Titolo"),
      pickedBox,
      h("div", {}, chooseBtn),
    ),
    field("Cliente", clientSel),
    hint,
    size.el,
    field(
      "Stop loss % (vendita forzata)",
      stopIn,
      "Se il titolo perde questa % viene venduto da solo",
    ),
    h(
      "div",
      { class: "modal-foot" },
      h(
        "button",
        { type: "button", class: "btn", onclick: () => m.close() },
        "Annulla",
      ),
      submit,
    ),
  );
  m.body.append(form);

  clientSel.addEventListener("change", () => {
    stopIn.value = "";
    update();
  });
  if (ownerSel)
    ownerSel.addEventListener("change", async () => {
      store.ownerId = parseInt(ownerSel.value, 10);
      store.emit("owners-changed");
      await loadClients();
    });
  await loadClients();
  if (preset.symbol) setPicked({ symbol: preset.symbol, name: preset.symbol });
}

// Struttura comune delle finestre di vendita: testo, campi extra, "quanto", errore e pulsanti
function sellForm(m, { intro, extra = [], size, send }) {
  let err;
  const submit = h(
    "button",
    { class: "btn danger", type: "submit" },
    "Vendi al prezzo attuale",
  );
  const form = h(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        submit.disabled = true;
        try {
          await send(size.read());
        } catch (ex) {
          err.show(ex.message);
        } finally {
          submit.disabled = false;
        }
      },
    },
    intro && h("p", { class: "muted", style: { margin: 0 } }, intro),
    ...extra,
    size.el,
    h(
      "div",
      { class: "modal-foot" },
      h(
        "button",
        { type: "button", class: "btn", onclick: () => m.close() },
        "Annulla",
      ),
      submit,
    ),
  );
  m.body.append(form);
  err = errorBox(form);
  size.refresh();
}

// Vendita dal titolo: quote libere (non assegnate) oppure una parte delle quote di un cliente
export async function openSellModal(p, onDone) {
  const m = modal(`Vendi ${p.name}`, { narrow: true });
  let allocs = [];
  try {
    allocs = await api.get(`/trade/position/${p.id}/allocations`);
  } catch {
    /* si vende solo da quote libere */
  }
  const priceEur = p.price != null && p.fx != null ? p.price * p.fx : null;
  const allocated = allocs.reduce((s, a) => s + (a.units || 0), 0);
  const free = Math.max(0, p.quantity - allocated);
  const source = select(
    "source",
    [
      ["free", `Quote libere (${num(free, 4)})`],
      ...allocs.map((a) => [
        a.id,
        `${a.clientName} · ${num(a.units, 4)} quote`,
      ]),
    ],
    free > EPS || !allocs.length ? "free" : allocs[0].id,
  );
  const maxOf = () => {
    const units =
      source.value === "free"
        ? free
        : (allocs.find((a) => String(a.id) === source.value) || {}).units;
    return units != null
      ? { units, euro: priceEur ? units * priceEur : null, exact: true }
      : null;
  };
  const size = sizeField({
    modes: ["quantity", "euro", "all"],
    getPrice: () => priceEur,
    getMax: maxOf,
  });
  source.addEventListener("change", () => size.refresh());

  sellForm(m, {
    intro: `Hai ${num(p.quantity, 4)} quote: ${num(free, 4)} libere e ${num(allocated, 4)} assegnate ai clienti. Scegli da dove vendere.`,
    extra: [field("Vendi da", source)],
    size,
    send: async (sz) => {
      if (source.value === "free") {
        const r = await api.post("/trade/sell", { positionId: p.id, ...sz });
        toast(
          "Vendita eseguita",
          `${num(r.quantity, 4)} quote a ${num(r.price)} ${r.currency} = ${eur(r.amountEur)}`,
          "success",
        );
      } else {
        const r = await api.post(`/trade/close/${source.value}`, sz);
        toast(
          r.partial ? "Venduta una parte" : "Venduto",
          saleText(r),
          r.pnl >= 0 ? "success" : "warning",
        );
      }
      m.close();
      onDone && onDone();
    },
  });
}

const saleText = (r) =>
  `${r.partial ? `${num(r.quantity, 4)} quote · ` : ""}incassati ${eur(r.proceeds)} (${pct(r.pnlPct)})${r.partial ? ` · restano ${num(r.remainingUnits, 4)} quote al cliente` : ""}`;

// Vendita (tutta o in parte) di un'allocazione cliente. x = riga della scheda cliente
export function openSellAllocationModal(x, onDone) {
  const m = modal(`Vendi ${x.name}`, { narrow: true });
  const size = sizeField({
    modes: ["quantity", "euro", "all"],
    getPrice: () => x.currentPriceEur,
    getMax: () =>
      x.units != null
        ? {
            units: x.units,
            euro:
              x.value != null
                ? x.value
                : x.currentPriceEur
                  ? x.units * x.currentPriceEur
                  : null,
            exact: true,
          }
        : null,
  });
  sellForm(m, {
    intro: `Il cliente ha ${num(x.units, 4)} quote (${eur(x.euro)} investiti). Puoi venderne solo una parte: il resto resta suo e l'incasso va nella sua liquidità.`,
    size,
    send: async (sz) => {
      const r = await api.post(`/trade/close/${x.id}`, sz);
      m.close();
      toast(
        r.partial ? "Venduta una parte" : "Venduto",
        saleText(r),
        r.pnl >= 0 ? "success" : "warning",
      );
      onDone && onDone(r);
    },
  });
}
