import { h, eur, num, pct, sign, dateTime, mount } from "../utils.js";
import { api } from "../api.js";
import { kpi, toast, loading, badge, countPill } from "./ui.js";
import { perfCard } from "./perf.js";
import { openBuyModal } from "./trade.js";
import { store } from "../store.js";

export async function renderDashboard(view) {
  loading(view);
  let pf, al;
  try {
    [pf, al] = await Promise.all([api.get("/positions"), api.get("/alerts")]);
  } catch (e) {
    mount(view, h("div", { class: "form-error" }, e.message));
    return;
  }
  const t = pf.totals,
    open = pf.positions.filter((p) => p.quantity > 0);

  const refresh = h(
    "button",
    {
      class: "btn",
      onclick: async () => {
        refresh.disabled = true;
        refresh.textContent = "Aggiorno…";
        try {
          const r = await api.post("/market/refresh");
          toast(
            "Quotazioni aggiornate",
            r.failed
              ? `${r.failed} titolo/i non aggiornati`
              : "Dati di mercato scaricati",
            r.failed ? "warning" : "success",
          );
        } catch (e) {
          toast("Aggiornamento non riuscito", e.message, "danger");
        }
        renderDashboard(view);
      },
    },
    "↻ Aggiorna quotazioni",
  );

  const priced = t.value != null;
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Dashboard"),
        h(
          "p",
          {},
          `Aggiornato ${dateTime(pf.generatedAt)} · dati Yahoo Finance`,
        ),
      ),
      h("span", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => openBuyModal({}, () => renderDashboard(view)),
        },
        "＋ Compra",
      ),
      refresh,
    ),
    t.quotesMissing > 0 &&
      h(
        "div",
        { class: "banner" },
        `⚠ ${t.quotesMissing} titolo/i senza quotazione: totali e pesi non sono completi. Controlla il ticker o inserisci un prezzo manuale.`,
      ),
    pf.ledgerErrors.length > 0 &&
      h(
        "div",
        { class: "banner" },
        `⚠ ${pf.ledgerErrors.length} operazione/i da correggere: ${pf.ledgerErrors[0].error}`,
      ),
    h(
      "div",
      { class: "grid kpis" },
      kpi(
        "Titoli in portafoglio",
        String(open.length),
        `${pf.positions.length} titoli seguiti · ${pf.positions.length - open.length} senza quote`,
      ),
      kpi(
        "Valore attuale",
        priced ? eur(t.value) : "n/d",
        `${t.openPositions} posizioni aperte`,
      ),
      kpi(
        "Costo posizioni",
        eur(t.cost),
        "prezzo medio, con cambio e commissioni",
      ),
      kpi(
        "Utile/perdita latente",
        t.pnl != null ? eur(t.pnl) : "n/d",
        t.pnlPct != null ? pct(t.pnlPct) : "",
        sign(t.pnl),
      ),
      kpi(
        "Realizzato",
        eur(t.realized),
        "da vendite, prima delle imposte",
        sign(t.realized),
      ),
      kpi("Dividendi netti", eur(t.dividends), "inseriti a mano"),
      kpi(
        "Quotazioni mancanti",
        String(t.quotesMissing || 0),
        t.quotesMissing
          ? "controlla ticker o prezzo manuale"
          : "tutti i titoli hanno un prezzo",
        t.quotesMissing ? "warn" : "",
      ),
      kpi(
        "Alert attivi",
        `${al.counts.danger + al.counts.warning}`,
        `${al.counts.danger} critici · ${al.counts.warning} da vedere`,
        al.counts.danger ? "down" : "",
      ),
    ),
    h(
      "div",
      { style: { marginTop: "14px" } },
      perfCard(
        "Andamento e rendite del portafoglio",
        `pf${store.ownerId}`,
        (days) => api.get(`/positions/performance?days=${days}`),
        { baseLabel: "Costo" },
      ),
    ),
    h(
      "div",
      { class: "grid two", style: { marginTop: "14px" } },
      h(
        "section",
        { class: "card" },
        h(
          "h2",
          {},
          "Alert da controllare",
          countPill(al.active.filter((a) => a.severity !== "info").length),
        ),
        alertList(al.active.filter((a) => a.severity !== "info").slice(0, 6)),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", {}, "Composizione per titolo", countPill(open.length)),
        weights(open),
      ),
    ),
    h(
      "div",
      { class: "grid two", style: { marginTop: "14px" } },
      h(
        "section",
        { class: "card" },
        h("h2", {}, "Per settore"),
        sectors(open),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", {}, "Migliori e peggiori"),
        movers(open),
      ),
    ),
    h(
      "p",
      { class: "disclaimer" },
      "Strumento di analisi: indicatori e alert non sono consigli di investimento. I prezzi arrivano da Yahoo Finance e possono avere ritardo.",
    ),
  );
}

export function alertList(items) {
  if (!items.length)
    return h("div", { class: "empty" }, "✓ Nessun alert attivo");
  return h(
    "div",
    { class: "stack", style: { gap: "8px" } },
    items.map((a) =>
      h(
        "a",
        {
          href: a.positionId ? `#/position/${a.positionId}` : "#/operations",
          class: `alert-item ${a.severity}`,
          style: { color: "inherit", textDecoration: "none" },
        },
        h("span", { class: "dot" }),
        h(
          "div",
          {},
          h("div", { class: "t" }, `${a.name || a.isin} · ${a.title}`),
          h("div", { class: "muted" }, a.message),
        ),
      ),
    ),
  );
}

function weights(open) {
  const rows = open
    .filter((p) => p.weight != null)
    .sort((a, b) => b.weight - a.weight);
  if (!rows.length)
    return h(
      "div",
      { class: "empty" },
      open.length
        ? "Pesi non disponibili: mancano quotazioni"
        : "Nessuna posizione aperta",
    );
  return h(
    "div",
    { class: "stack ranked", style: { gap: "12px" } },
    rows.map((p) => {
      const over = p.maxWeight != null && p.weight > p.maxWeight;
      return h(
        "div",
        {},
        h(
          "div",
          { class: "row" },
          h("a", { href: `#/position/${p.id}` }, p.name),
          h("span", { class: "spacer" }),
          h("span", { class: "num" }, `${num(p.weight, 1)}%`),
          p.maxWeight != null &&
            h("span", { class: "muted" }, `/ max ${num(p.maxWeight, 0)}%`),
        ),
        h(
          "div",
          { class: `bar${over ? " over" : ""}` },
          h("span", { style: { width: `${Math.min(100, p.weight)}%` } }),
        ),
      );
    }),
  );
}

function sectors(open) {
  const m = new Map();
  for (const p of open)
    if (p.value != null)
      m.set(
        p.sector || "Non indicato",
        (m.get(p.sector || "Non indicato") || 0) + p.value,
      );
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  if (!tot) return h("div", { class: "empty" }, "Nessun dato");
  return h(
    "div",
    { class: "stack ranked", style: { gap: "12px" } },
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) =>
        h(
          "div",
          {},
          h(
            "div",
            { class: "row" },
            h("span", {}, k),
            h("span", { class: "spacer" }),
            h(
              "span",
              { class: "num" },
              `${num((v / tot) * 100, 1)}% · ${eur(v, 0)}`,
            ),
          ),
          h(
            "div",
            { class: "bar" },
            h("span", { style: { width: `${(v / tot) * 100}%` } }),
          ),
        ),
      ),
  );
}

function movers(open) {
  const rows = open
    .filter((p) => p.pnlPct != null)
    .sort((a, b) => b.pnlPct - a.pnlPct);
  if (!rows.length) return h("div", { class: "empty" }, "Nessun dato");
  const pick =
    rows.length > 6 ? [...rows.slice(0, 3), ...rows.slice(-3)] : rows;
  return h(
    "div",
    { class: "stack ranked", style: { gap: "10px" } },
    pick.map((p) =>
      h(
        "div",
        { class: "row" },
        h("a", { href: `#/position/${p.id}` }, p.name),
        h("span", { class: "spacer" }),
        badge(
          p.trend || "—",
          p.trend === "Rialzista"
            ? "success"
            : p.trend === "Ribassista"
              ? "danger"
              : "neutral",
        ),
        h("span", { class: `num ${sign(p.pnlPct)}` }, pct(p.pnlPct)),
        h(
          "span",
          { class: `num ${sign(p.pnl)}`, style: { minWidth: "90px" } },
          eur(p.pnl),
        ),
      ),
    ),
  );
}
