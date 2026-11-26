// Grafico delle rendite: valore nel tempo contro costo/investito, e rendimento % sotto.
import { h, eur, pct, sign } from "../utils.js";
import { lineChart } from "./chart.js";

const cache = new Map(); // per non far lampeggiare il grafico a ogni aggiornamento in diretta

export function perfCard(title, key, load, { baseLabel = "Costo" } = {}) {
  const box = h("div", {});
  let days = 180;
  const draw = (d) => {
    if (!d || d.times.length < 2) {
      box.replaceChildren(
        h(
          "div",
          { class: "empty" },
          "Dati insufficienti: servono operazioni o assegnazioni e almeno due giorni di quotazioni.",
        ),
      );
      return;
    }
    const base = d.cost || d.invested,
      last = d.value.length - 1;
    const pnl = d.value[last] - base[last],
      rate = d.pnlPct[last];
    box.replaceChildren(
      h(
        "div",
        { class: "row", style: { marginBottom: "8px" } },
        h("b", { style: { fontSize: "20px" } }, eur(d.value[last])),
        h("span", { class: sign(pnl) }, `${eur(pnl)} · ${pct(rate)}`),
        h(
          "span",
          { class: "muted" },
          `${baseLabel.toLowerCase()} ${eur(base[last])}`,
        ),
      ),
      lineChart({
        times: d.times,
        height: 260,
        format: (v) => eur(v, 0),
        series: [
          { name: "Valore", values: d.value, color: "#22d3ee", width: 2.2 },
          {
            name: baseLabel,
            values: base,
            color: "#7f90b5",
            dash: "5 4",
            width: 1.5,
          },
        ],
      }),
      h(
        "div",
        { class: "muted", style: { fontSize: "12px", margin: "10px 0 2px" } },
        "Rendimento %",
      ),
      lineChart({
        times: d.times,
        height: 150,
        format: (v) => pct(v, 1),
        guides: [{ value: 0, label: "0%", color: "#7f90b5" }],
        series: [
          {
            name: "Rendimento",
            values: d.pnlPct,
            color: "#6ea0ff",
            width: 1.8,
          },
        ],
      }),
    );
  };
  const fetchIt = async () => {
    const ck = `${key}|${days}`;
    if (cache.has(ck)) draw(cache.get(ck));
    else
      box.replaceChildren(
        h("div", { class: "skeleton" }, "Carico il grafico…"),
      );
    try {
      const d = await load(days);
      cache.set(ck, d);
      draw(d);
    } catch (e) {
      if (!cache.has(ck))
        box.replaceChildren(h("div", { class: "form-error" }, e.message));
    }
  };
  const seg = h(
    "div",
    { class: "seg" },
    [
      [90, "3M"],
      [180, "6M"],
      [365, "1A"],
    ].map(([d, l]) =>
      h(
        "button",
        {
          class: d === days ? "on" : "",
          onclick: (e) => {
            days = d;
            seg
              .querySelectorAll("button")
              .forEach((b) => b.classList.remove("on"));
            e.currentTarget.classList.add("on");
            fetchIt();
          },
        },
        l,
      ),
    ),
  );
  fetchIt();
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "row", style: { marginBottom: "10px" } },
      h("h2", { style: { margin: 0 } }, title),
      h("span", { class: "spacer" }),
      seg,
    ),
    box,
  );
}
