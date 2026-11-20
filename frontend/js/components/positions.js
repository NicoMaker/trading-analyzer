import { h, eur, num, pct, sign, debounce, mount } from "../utils.js";
import { api } from "../api.js";
import {
  modal,
  confirmDialog,
  toast,
  field,
  input,
  select,
  formData,
  errorBox,
  alertBadges,
  badge,
  loading,
  emptyRow,
  kpi,
} from "./ui.js";
import { openSearch } from "./search.js";
import { openBuyModal, openSellModal } from "./trade.js";
export { openSearch };

const RISKS = ["Basso", "Medio", "Alto", "Molto alto", "Da valutare"];
const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "DKK",
  "NOK",
  "SEK",
  "JPY",
  "CAD",
  "AUD",
  "Altro",
];

let filterText = ""; // si azzera a ogni apertura della pagina: all'ingresso si vedono sempre tutti i titoli

export async function renderPositions(view, { keepFilter = false } = {}) {
  if (!keepFilter) filterText = "";
  loading(view);
  let pf;
  try {
    pf = await api.get("/positions");
  } catch (e) {
    mount(view, h("div", { class: "form-error" }, e.message));
    return;
  }
  const reload = () => renderPositions(view, { keepFilter: true });

  const rows = pf.positions.map((p) => {
    const tr = row(p, reload);
    tr.dataset.q = `${p.name} ${p.ticker || ""} ${p.isin}`.toLowerCase();
    return tr;
  });
  const none = emptyRow(12, "Nessun titolo corrisponde alla ricerca.");
  none.classList.add("hidden");
  // Titoli disponibili ma non (ancora) in portafoglio: vengono sempre elencati, con il prezzo reale
  const extraHead = h(
    "tr",
    { class: "group-head" },
    h(
      "td",
      { colspan: 12 },
      "Altri titoli disponibili (non in portafoglio) — prezzo in tempo reale",
    ),
  );
  const extraLoading = h(
    "tr",
    {},
    h(
      "td",
      { colspan: 12, class: "muted" },
      "Carico i prezzi degli altri titoli…",
    ),
  );
  let extraRows = [];
  const body = h("tbody", {}, [...rows, none, extraHead, extraLoading]);
  // Filtro: vuoto = tutti i titoli
  const filter = input("filter", {
    type: "search",
    placeholder: "Filtra i tuoi titoli (vuoto = tutti)",
    autocomplete: "off",
    style: { minWidth: "220px" },
    value: filterText,
  });
  const applyFilter = () => {
    filterText = filter.value;
    const t = filterText.trim().toLowerCase();
    let n = 0;
    for (const r of rows) {
      const show = !t || r.dataset.q.includes(t);
      r.classList.toggle("hidden", !show);
      if (show) n++;
    }
    let m = 0;
    for (const r of extraRows) {
      const show = !t || r.dataset.q.includes(t);
      r.classList.toggle("hidden", !show);
      if (show) m++;
    }
    none.classList.toggle(
      "hidden",
      n + m > 0 || !(rows.length + extraRows.length),
    );
    extraHead.classList.toggle("hidden", !extraRows.length || m === 0);
  };
  filter.addEventListener("input", applyFilter);
  applyFilter();

  const t = pf.totals;
  const kpis = h(
    "div",
    { class: "grid kpis", style: { marginBottom: "16px" } },
    kpi(
      "Titoli in portafoglio",
      String(pf.positions.filter((p) => p.quantity > 0).length),
      `${pf.positions.length} seguiti in totale`,
    ),
    kpi("Titoli disponibili", "…", "non in portafoglio"),
    kpi(
      "Valore attuale",
      t.value != null ? eur(t.value) : "n/d",
      `costo ${eur(t.cost)}`,
    ),
    kpi(
      "Utile/perdita latente",
      t.pnl != null ? eur(t.pnl) : "n/d",
      t.pnlPct != null ? pct(t.pnlPct) : "",
      sign(t.pnl),
    ),
  );
  async function loadExtra() {
    try {
      const all = await api.get("/market/catalog"); // elenco completo, subito
      const cells = new Map();
      extraRows = all
        .filter((x) => !x.inPortfolio)
        .map((x) => {
          const tr = extraRow(x, reload);
          tr.dataset.q = `${x.name} ${x.symbol}`.toLowerCase();
          cells.set(x.symbol, [x, tr]);
          return tr;
        });
      extraLoading.replaceWith(...extraRows);
      kpis.children[1].querySelector(".value").textContent = String(
        extraRows.length,
      );
      applyFilter();
      const priced = await api.get("/market/search?q="); // poi i prezzi reali aggiornati
      for (const x of priced) {
        const e = cells.get(x.symbol);
        if (e) {
          const nr = extraRow(x, reload);
          nr.dataset.q = e[1].dataset.q;
          nr.classList.toggle("hidden", e[1].classList.contains("hidden"));
          e[1].replaceWith(nr);
          extraRows[extraRows.indexOf(e[1])] = nr;
        }
      }
    } catch (e) {
      if (!extraRows.length)
        extraLoading.firstChild.textContent = `Altri titoli non disponibili: ${e.message}`;
    }
    applyFilter();
  }
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Titoli"),
        h("p", {}, "Posizioni, quotazioni reali e soglie di alert"),
      ),
      h("span", { class: "spacer" }),
      filter,
      h(
        "button",
        {
          class: "btn",
          onclick: () =>
            openSearch(() => {}, "", {
              title: "Tutti i titoli e prezzi reali",
            }),
        },
        "🔍 Titoli",
      ),
      h(
        "button",
        { class: "btn primary", onclick: () => openBuyModal({}, reload) },
        "＋ Compra",
      ),
      h(
        "button",
        { class: "btn", onclick: () => openPositionForm(null, reload) },
        "Nuovo titolo",
      ),
    ),
    kpis,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            [
              "Titolo",
              "Quantità",
              "Prezzo medio acq.",
              "Prezzo",
              "Giorno",
              "Costo €",
              "Valore €",
              "Utile/perdita",
              "Peso",
              "Trend · RSI",
              "Alert",
              "",
            ].map((x, i) =>
              h(
                "th",
                { class: [1, 2, 3, 4, 5, 6, 7, 8].includes(i) ? "num" : "" },
                x,
              ),
            ),
          ),
        ),
        body,
      ),
    ),
    h(
      "p",
      { class: "disclaimer" },
      "Costo = prezzo medio mobile con cambio e commissioni. Peso calcolato solo sui titoli in portafoglio. I titoli non acquistati mostrano solo il prezzo reale.",
    ),
  );
  loadExtra();
}

// Riga di un titolo non in portafoglio: nome, prezzo reale e variazione del giorno, senza dati di posizione
function extraRow(x, reload) {
  const stale = x.stale
    ? badge("datato", "warning", "API non raggiungibile: ultimo prezzo salvato")
    : null;
  return h(
    "tr",
    { class: "not-owned" },
    h(
      "td",
      {},
      h("span", { class: "name" }, x.name),
      h(
        "div",
        { class: "sub" },
        [x.symbol, x.exchange, x.sector].filter(Boolean).join(" · "),
      ),
      " ",
      badge("non acquistato", "neutral"),
    ),
    h("td", { class: "num" }, "—"),
    h("td", { class: "num" }, "—"),
    h(
      "td",
      { class: "num" },
      x.price != null
        ? `${num(x.price)} ${x.currency || ""}`
        : "prezzo in arrivo…",
      stale && h("div", {}, stale),
    ),
    h(
      "td",
      { class: `num ${sign(x.dayChangePct)}` },
      x.dayChangePct != null ? pct(x.dayChangePct) : "—",
    ),
    h("td", { class: "num" }, "—"),
    h("td", { class: "num" }, "—"),
    h("td", { class: "num" }, "—"),
    h("td", { class: "num" }, "—"),
    h("td", {}, "—"),
    h("td", {}, "—"),
    h(
      "td",
      {},
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            class: "btn sm primary",
            onclick: () => openBuyModal({ symbol: x.symbol }, reload),
          },
          "Compra",
        ),
        h(
          "button",
          {
            class: "btn sm",
            title: "Aggiungi alla lista dei tuoi titoli senza comprare",
            onclick: () =>
              openPositionForm(
                {
                  __new: true,
                  name: x.name,
                  ticker: x.symbol,
                  sector: x.sector || "",
                  isin: x.symbol,
                  currency: x.currency || "EUR",
                },
                reload,
              ),
          },
          "Aggiungi",
        ),
      ),
    ),
  );
}

function row(p, reload) {
  const src =
    p.priceSource === "manuale"
      ? badge("manuale", "info", "Prezzo inserito a mano")
      : p.priceSource === "cache"
        ? badge(
            "datato",
            "warning",
            "API non raggiungibile: ultimo prezzo salvato",
          )
        : null;
  return h(
    "tr",
    {},
    h(
      "td",
      {},
      h("a", { href: `#/position/${p.id}`, class: "name" }, p.name),
      h("div", { class: "sub" }, `${p.ticker || "senza ticker"} · ${p.isin}`),
    ),
    h("td", { class: "num" }, num(p.quantity, 4)),
    h("td", { class: "num" }, p.avgPrice != null ? eur(p.avgPrice, 4) : "—"),
    h(
      "td",
      { class: "num" },
      p.price != null ? `${num(p.price)} ${p.currency}` : "—",
      src && h("div", {}, src),
    ),
    h("td", { class: `num ${sign(p.dayChangePct)}` }, pct(p.dayChangePct)),
    h("td", { class: "num" }, p.quantity > 0 ? eur(p.cost) : "—"),
    h("td", { class: "num" }, p.quantity > 0 ? eur(p.value) : "—"),
    h(
      "td",
      { class: `num ${sign(p.pnl)}` },
      p.quantity > 0
        ? [eur(p.pnl), h("div", { class: "sub" }, pct(p.pnlPct))]
        : "—",
    ),
    h("td", { class: "num" }, p.weight != null ? `${num(p.weight, 1)}%` : "—"),
    h(
      "td",
      {},
      p.trend
        ? badge(
            p.trend,
            p.trend === "Rialzista"
              ? "success"
              : p.trend === "Ribassista"
                ? "danger"
                : "neutral",
          )
        : "—",
      p.rsi != null && h("span", { class: "muted" }, ` ${num(p.rsi, 0)}`),
    ),
    h("td", {}, alertBadges(p.alerts, 2)),
    h(
      "td",
      {},
      h(
        "div",
        { class: "actions" },
        p.quantity > 0 &&
          p.ticker &&
          h(
            "button",
            { class: "btn sm", onclick: () => openSellModal(p, reload) },
            "Vendi",
          ),
        h(
          "button",
          { class: "btn sm", onclick: () => openPositionForm(p, reload) },
          "Modifica",
        ),
        h(
          "button",
          {
            class: "btn sm danger",
            "aria-label": "Elimina",
            onclick: async () => {
              if (
                !(await confirmDialog(
                  "Eliminare il titolo?",
                  `${p.name}: verranno eliminate anche le sue operazioni e le allocazioni ai clienti.`,
                  { okLabel: "Elimina" },
                ))
              )
                return;
              try {
                await api.del(`/positions/${p.id}`);
                toast("Titolo eliminato", p.name, "success");
                reload();
              } catch (e) {
                toast("Errore", e.message, "danger");
              }
            },
          },
          "🗑",
        ),
      ),
    ),
  );
}

// ---- Form titolo (nuovo/modifica) --------------------------------------------------------------
export function openPositionForm(p, onSaved) {
  const editing = !!p && !p.__new;
  const m = modal(editing ? `Modifica ${p.name}` : "Nuovo titolo");
  const v = (k) => (p && p[k] != null ? p[k] : "");
  const num_ = (name, label, key, hint, extra = {}) =>
    field(
      label,
      input(name, { type: "number", step: "any", value: v(key), ...extra }),
      hint,
    );

  const isin = input("isin", {
    value: p && p.__new ? "" : v("isin"),
    placeholder: "es. US0378331005",
    disabled: editing,
    maxlength: 30,
  });
  const name = input("name", {
    value: v("name"),
    required: true,
    maxlength: 200,
  });
  const ticker = input("ticker", {
    value: v("ticker"),
    placeholder: "es. AAPL, ENI.MI, VOD.L",
  });
  const currency = select("currency", CURRENCIES, v("currency") || "EUR");
  const sector = input("sector", { value: v("sector") });
  const searchBtn = h(
    "button",
    {
      type: "button",
      class: "btn sm",
      onclick: () =>
        openSearch(async (r) => {
          ticker.value = r.symbol;
          name.value = name.value || r.name;
          if (r.sector) sector.value = sector.value || r.sector;
          if (!isin.disabled && !isin.value && r.isin) isin.value = r.isin;
          try {
            const q = await api.get(
              `/market/quote/${encodeURIComponent(r.symbol)}`,
            );
            if (CURRENCIES.includes(q.currency)) currency.value = q.currency;
            toast(
              "Quotazione trovata",
              `${r.symbol}: ${num(q.price)} ${q.currency}`,
              "success",
            );
          } catch (e) {
            toast("Quotazione non disponibile", e.message, "warning");
          }
        }, isin.value),
    },
    "🔍 Cerca titolo",
  );

  const form = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        const d = formData(form);
        if (!editing && !d.isin.trim()) d.isin = (d.ticker || "").trim(); // senza ISIN si usa il ticker come codice
        if (editing) d.isin = p.isin;
        try {
          if (editing) await api.put(`/positions/${p.id}`, d);
          else await api.post("/positions", d);
          m.close();
          toast(
            editing ? "Titolo aggiornato" : "Titolo aggiunto",
            d.name,
            "success",
          );
          onSaved();
        } catch (ex) {
          err.show(ex.message);
        }
      },
    },
    h("div", { class: "form-section", style: { marginTop: 0 } }, "Titolo"),
    h(
      "div",
      { class: "form-grid" },
      field(
        "ISIN (o codice)",
        isin,
        editing ? "Non modificabile" : "Se lo lasci vuoto si usa il ticker",
      ),
      field("Nome", name),
      field("Ticker (dati di mercato)", ticker, "Formato Yahoo Finance"),
      h("div", { class: "field" }, h("label", {}, "Ricerca"), searchBtn),
      field("Valuta", currency),
      field("Settore", sector),
      field(
        "Rischio personale",
        select("risk", RISKS, v("risk") || "Da valutare"),
      ),
    ),
    h("div", { class: "form-section" }, "Alert: ti avviso se…"),
    h(
      "div",
      { class: "form-grid" },
      num_(
        "stopPrice",
        "Prezzo scende a (stop)",
        "stopPrice",
        "nella valuta del titolo",
      ),
      num_(
        "targetPrice",
        "Prezzo sale a (obiettivo)",
        "targetPrice",
        "nella valuta del titolo",
      ),
      num_(
        "minValueEur",
        "Valore posizione sotto € ",
        "minValueEur",
        "in euro",
      ),
      num_("minPlPct", "Utile/perdita sotto %", "minPlPct", "es. -10"),
      num_("dayDropPct", "Calo giornaliero oltre %", "dayDropPct", "es. 5"),
      num_("maxWeight", "Peso oltre %", "maxWeight", "peso massimo"),
      num_("rsiLow", "RSI sotto (ipervenduto)", "rsiLow", "default 30"),
      num_("rsiHigh", "RSI sopra (ipercomprato)", "rsiHigh", "default 70"),
      field(
        "Prossima revisione",
        input("nextReview", { type: "date", value: v("nextReview") }),
      ),
    ),
    h("div", { class: "form-section" }, "Altro"),
    h(
      "div",
      { class: "form-grid" },
      num_("dividends", "Dividendi netti EUR", "dividends", "totale, a mano", {
        min: 0,
      }),
      num_(
        "manualPrice",
        "Prezzo manuale",
        "manualPrice",
        "solo se l'API non risponde",
      ),
      num_("manualFx", "Cambio manuale", "manualFx", "EUR per 1 valuta"),
      h(
        "div",
        { class: "wide" },
        field(
          "Note e motivo acquisto",
          h("textarea", { name: "notes", maxlength: 2000 }, v("notes")),
        ),
      ),
    ),
    h(
      "div",
      { class: "modal-foot" },
      h(
        "button",
        { type: "button", class: "btn", onclick: () => m.close() },
        "Annulla",
      ),
      h(
        "button",
        { class: "btn primary", type: "submit" },
        editing ? "Salva" : "Aggiungi",
      ),
    ),
  );
  m.body.append(form);
  const err = errorBox(form);
}
