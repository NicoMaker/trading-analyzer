// Acquisto e vendita a prezzo di mercato reale. Per l'admin: si sceglie il portafoglio dell'utente in cui operare.
import { h, eur, num, mount } from "../utils.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { modal, toast, field, input, select, errorBox, badge } from "./ui.js";
import { openSearch } from "./search.js";

// preset: { clientId, symbol }
export async function openBuyModal(preset = {}, onDone) {
  const m = modal("Compra titolo");
  let picked = null,
    clients = [];
  const err = { show() {}, hide() {} };

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
  const euroIn = input("euro", {
    type: "number",
    step: "0.01",
    min: 0.01,
    required: true,
    placeholder: "es. 500",
  });
  const stopIn = input("stopLossPct", {
    type: "number",
    step: "any",
    min: 0,
    max: 99,
    placeholder: "vuoto = standard del cliente",
  });
  const hint = h("div", { class: "muted", style: { fontSize: "12px" } });
  const preview = h("div", { class: "preview hidden" });
  const errBox = h("div", { class: "form-error hidden", role: "alert" });
  const submit = h(
    "button",
    { class: "btn primary", type: "submit" },
    "Compra al prezzo attuale",
  );

  const cur = () => clients.find((c) => String(c.id) === clientSel.value);
  const update = () => {
    const c = cur();
    hint.textContent = c
      ? `Capitale ${eur(c.capital)} · puo' ancora investire ${eur(c.cash)}${c.defaultStopPct ? ` · stop standard -${c.defaultStopPct}%` : ""}`
      : "Senza cliente: l'acquisto va solo nel portafoglio (nessun limite di capitale).";
    if (c && !stopIn.value)
      stopIn.placeholder = c.defaultStopPct
        ? `standard: ${c.defaultStopPct}`
        : "nessuno";
    const v = parseFloat(euroIn.value);
    if (picked && picked.priceEur && v > 0) {
      preview.classList.remove("hidden");
      preview.textContent = `≈ ${num(v / picked.priceEur, 4)} quote a ${num(picked.priceEur, 4)} € (prezzo reale ${num(picked.price)} ${picked.currency})${c && v > c.cash + 0.005 ? " — oltre il capitale disponibile" : ""}`;
    } else preview.classList.add("hidden");
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
  const maxBtn = h(
    "button",
    {
      type: "button",
      class: "btn sm",
      onclick: () => {
        const c = cur();
        if (c && c.cash > 0) {
          euroIn.value = Math.floor(c.cash * 100) / 100;
          update();
        }
      },
    },
    "Max disponibile",
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
          const r = await api.post("/trade/buy", {
            symbol: picked.symbol,
            euro: euroIn.value,
            clientId: clientSel.value || null,
            stopLossPct: stopIn.value,
          });
          m.close();
          toast(
            "Acquisto eseguito",
            `${eur(r.euro)} su ${r.name} a ${num(r.price)} ${r.currency}${clientSel.value ? " · cliente avvisato" : ""}`,
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
    h(
      "div",
      { class: "form-grid" },
      h(
        "div",
        {},
        field("Importo da investire €", euroIn),
        h("div", { style: { marginTop: "6px" } }, maxBtn),
      ),
      field(
        "Stop loss % (vendita forzata)",
        stopIn,
        "Se il titolo perde questa % viene venduto da solo",
      ),
    ),
    preview,
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
  euroIn.addEventListener("input", update);
  if (ownerSel)
    ownerSel.addEventListener("change", async () => {
      store.ownerId = parseInt(ownerSel.value, 10);
      store.emit("owners-changed");
      await loadClients();
    });
  await loadClients();
  if (preset.symbol) setPicked({ symbol: preset.symbol, name: preset.symbol });
}

// Vendita di quote del portafoglio non assegnate ai clienti
export function openSellModal(p, onDone) {
  const m = modal(`Vendi ${p.name}`, { narrow: true });
  const q = input("quantity", {
    type: "number",
    step: "any",
    min: 0,
    placeholder: `max ${num(p.quantity, 4)}`,
  });
  const all = h("input", { type: "checkbox", name: "all" });
  const form = h(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        try {
          const r = await api.post("/trade/sell", {
            positionId: p.id,
            quantity: q.value,
            all: all.checked,
          });
          m.close();
          toast(
            "Vendita eseguita",
            `${num(r.quantity, 4)} quote a ${num(r.price)} ${r.currency} = ${eur(r.amountEur)}`,
            "success",
          );
          onDone && onDone();
        } catch (ex) {
          err.show(ex.message);
        }
      },
    },
    h(
      "p",
      { class: "muted", style: { margin: 0 } },
      `Hai ${num(p.quantity, 4)} quote. Le quote assegnate ai clienti non si vendono da qui: usa "Vendi" nella scheda del cliente.`,
    ),
    field("Quantità da vendere", q),
    h("label", { class: "checkbox" }, all, "Vendi tutte le quote libere"),
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
        { class: "btn danger", type: "submit" },
        "Vendi al prezzo attuale",
      ),
    ),
  );
  m.body.append(form);
  const err = errorBox(form);
}
