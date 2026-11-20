import { h, eur, num, sign, today, dateIt, mount } from "../utils.js";
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
  loading,
  emptyRow,
  badge,
  kpi,
} from "./ui.js";

export async function renderOperations(view) {
  loading(view);
  let ops, pf;
  try {
    [ops, pf] = await Promise.all([
      api.get("/operations"),
      api.get("/positions"),
    ]);
  } catch (e) {
    mount(view, h("div", { class: "form-error" }, e.message));
    return;
  }
  const reload = () => renderOperations(view);
  const names = new Map(pf.positions.map((p) => [p.isin, p.name]));
  let filter = "";

  const tbody = h("tbody");
  const fill = () => {
    const list = ops.filter((o) => !filter || o.isin === filter);
    tbody.replaceChildren(
      ...(list.length
        ? list.map((o) =>
            h(
              "tr",
              {},
              h("td", {}, dateIt(o.date)),
              h(
                "td",
                {},
                h("div", { class: "name" }, names.get(o.isin) || o.isin),
                h("div", { class: "sub" }, o.isin),
              ),
              h(
                "td",
                {},
                badge(o.type, o.type === "Acquisto" ? "info" : "warning"),
              ),
              h("td", { class: "num" }, num(o.quantity, 4)),
              h("td", { class: "num" }, num(o.price, 4)),
              h("td", { class: "num" }, num(o.fx, 4)),
              h("td", { class: "num" }, num(o.fees)),
              h("td", { class: "num" }, eur(o.amountEur)),
              h(
                "td",
                { class: `num ${sign(o.result)}` },
                o.type === "Vendita" ? eur(o.result) : "—",
              ),
              h(
                "td",
                { class: "muted" },
                o.error ? badge(o.error, "danger") : o.note || "",
              ),
              h(
                "td",
                {},
                h(
                  "div",
                  { class: "actions" },
                  h(
                    "button",
                    {
                      class: "btn sm",
                      onclick: () => openOperationForm(pf.positions, o, reload),
                    },
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
                            "Eliminare l'operazione?",
                            `${o.type} ${num(o.quantity, 4)} · ${names.get(o.isin) || o.isin} del ${dateIt(o.date)}`,
                            { okLabel: "Elimina" },
                          ))
                        )
                          return;
                        try {
                          await api.del(`/operations/${o.id}`);
                          toast("Operazione eliminata", "", "success");
                          reload();
                        } catch (e) {
                          toast("Non eliminata", e.message, "danger");
                        }
                      },
                    },
                    "🗑",
                  ),
                ),
              ),
            ),
          )
        : [emptyRow(11, "Nessuna operazione registrata.")]),
    );
  };
  fill();

  const sel = select(
    "f",
    [["", "Tutti i titoli"], ...pf.positions.map((p) => [p.isin, p.name])],
    "",
  );
  sel.addEventListener("change", () => {
    filter = sel.value;
    fill();
  });
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Operazioni"),
        h(
          "p",
          {},
          "Registro acquisti e vendite: l'ordine è calcolato per data, non devi riordinare nulla",
        ),
      ),
      h("span", { class: "spacer" }),
      h("div", { style: { minWidth: "200px" } }, sel),
      h(
        "button",
        {
          class: "btn primary",
          disabled: !pf.positions.length,
          onclick: () => openOperationForm(pf.positions, null, reload),
        },
        "+ Nuova operazione",
      ),
    ),
    !pf.positions.length &&
      h(
        "div",
        { class: "banner" },
        'Aggiungi prima un titolo nella sezione "Titoli".',
      ),
    h(
      "div",
      { class: "grid kpis", style: { marginBottom: "16px" } },
      kpi(
        "Operazioni totali",
        String(ops.length),
        `${ops.filter((o) => o.type === "Acquisto").length} acquisti · ${ops.filter((o) => o.type === "Vendita").length} vendite`,
      ),
      kpi(
        "Acquistato",
        eur(
          ops
            .filter((o) => o.type === "Acquisto")
            .reduce((a, o) => a + (o.amountEur || 0), 0),
        ),
        "importo totale degli acquisti",
      ),
      kpi(
        "Venduto",
        eur(
          ops
            .filter((o) => o.type === "Vendita")
            .reduce((a, o) => a + (o.amountEur || 0), 0),
        ),
        "incassi al netto delle commissioni",
      ),
      kpi(
        "Risultato realizzato",
        eur(
          ops.reduce(
            (a, o) => a + (o.type === "Vendita" ? o.result || 0 : 0),
            0,
          ),
        ),
        "somma dei risultati delle vendite",
        sign(
          ops.reduce(
            (a, o) => a + (o.type === "Vendita" ? o.result || 0 : 0),
            0,
          ),
        ),
      ),
    ),
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
              "Data",
              "Titolo",
              "Tipo",
              "Quantità",
              "Prezzo",
              "Cambio",
              "Commissioni",
              "Importo €",
              "Risultato €",
              "Note",
              "",
            ].map((x, i) =>
              h("th", { class: i >= 3 && i <= 8 ? "num" : "" }, x),
            ),
          ),
        ),
        tbody,
      ),
    ),
    h(
      "p",
      { class: "disclaimer" },
      "Cambio = EUR per 1 unità di valuta (per i titoli in EUR scrivi 1). Importo acquisto = quantità × prezzo × cambio + commissioni; la vendita è al netto. Il costo venduto usa il prezzo medio mobile.",
    ),
  );
}

function openOperationForm(positions, o, onSaved) {
  const editing = !!o;
  const m = modal(editing ? "Modifica operazione" : "Nuova operazione");
  const posSel = select(
    "isin",
    positions.map((p) => [p.isin, `${p.name} (${p.currency})`]),
    o ? o.isin : positions[0].isin,
  );
  const fx = input("fx", {
    type: "number",
    step: "any",
    min: 0,
    value: o ? o.fx : 1,
  });
  const price = input("price", {
    type: "number",
    step: "any",
    min: 0,
    required: true,
    value: o ? o.price : "",
  });
  const hint = h("span", { class: "hint" });
  const current = () => positions.find((p) => p.isin === posSel.value);
  const suggest = () => {
    const p = current();
    hint.textContent =
      p && p.price != null
        ? `Ultimo prezzo ${num(p.price)} ${p.currency}${p.fx != null && p.currency !== "EUR" ? ` · cambio ${num(p.fx, 4)}` : ""}`
        : "";
  };
  posSel.addEventListener("change", suggest);
  suggest();
  const useNow = h(
    "button",
    {
      type: "button",
      class: "btn sm",
      onclick: () => {
        const p = current();
        if (!p) return;
        if (p.price != null) price.value = p.price;
        if (p.fx != null) fx.value = p.fx;
      },
    },
    "Usa prezzo e cambio attuali",
  );

  const dateIn = input("date", {
    type: "date",
    required: true,
    max: today(),
    value: o ? o.date : today(),
  });
  const useDate = h(
    "button",
    {
      type: "button",
      class: "btn sm",
      onclick: async () => {
        const p = current();
        if (!p || !p.ticker) {
          toast(
            "Ticker mancante",
            "Imposta il ticker del titolo per scaricare i prezzi",
            "warning",
          );
          return;
        }
        useDate.disabled = true;
        try {
          const r = await api.get(
            `/market/price-at?symbol=${encodeURIComponent(p.ticker)}&date=${dateIn.value}`,
          );
          price.value = Number(r.price.toFixed(4));
          if (r.fx != null) fx.value = Number(r.fx.toFixed(6));
          else if (p.currency !== "EUR")
            toast(
              "Cambio non trovato",
              "Inserisci il cambio a mano",
              "warning",
            );
          toast(
            "Prezzo compilato",
            `Chiusura del ${r.priceDate}: ${num(r.price, 4)} ${r.currency}`,
            "success",
          );
        } catch (ex) {
          toast("Prezzo non disponibile", ex.message, "warning");
        } finally {
          useDate.disabled = false;
        }
      },
    },
    "Prezzo di mercato alla data",
  );

  const form = h(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        try {
          const d = formData(form);
          if (editing) await api.put(`/operations/${o.id}`, d);
          else await api.post("/operations", d);
          m.close();
          toast(
            editing ? "Operazione aggiornata" : "Operazione registrata",
            "",
            "success",
          );
          onSaved();
        } catch (ex) {
          err.show(ex.message);
        }
      },
    },
    h(
      "div",
      { class: "form-grid" },
      field("Data", dateIn),
      field("Titolo", posSel),
      field(
        "Tipo",
        select("type", ["Acquisto", "Vendita"], o ? o.type : "Acquisto"),
      ),
      field(
        "Quantità",
        input("quantity", {
          type: "number",
          step: "any",
          min: 0,
          required: true,
          value: o ? o.quantity : "",
        }),
      ),
      field("Prezzo in valuta", price, null),
      field("EUR per 1 valuta", fx, "1 per titoli in EUR"),
      field(
        "Commissioni EUR",
        input("fees", {
          type: "number",
          step: "any",
          min: 0,
          value: o ? o.fees : 0,
        }),
        "0 se assenti",
      ),
      h(
        "div",
        { class: "wide" },
        h("div", { class: "row" }, useDate, useNow, hint),
      ),
      h(
        "div",
        { class: "wide" },
        field(
          "Note",
          input("note", { value: o ? o.note || "" : "", maxlength: 300 }),
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
      h("button", { class: "btn primary", type: "submit" }, "Salva"),
    ),
  );
  m.body.append(form);
  const err = errorBox(form);
}
