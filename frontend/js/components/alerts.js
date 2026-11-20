import { h, dateIt, mount } from "../utils.js";
import { api } from "../api.js";
import { loading, badge, kpi } from "./ui.js";
import { alertList } from "./dashboard.js";

export async function renderAlerts(view) {
  loading(view);
  let data;
  try {
    data = await api.get("/alerts");
  } catch (e) {
    mount(view, h("div", { class: "form-error" }, e.message));
    return;
  }
  const c = data.counts;
  let level = "tutti";
  const box = h("div");
  const draw = () =>
    box.replaceChildren(
      alertList(
        data.active.filter((a) => level === "tutti" || a.severity === level),
      ),
    );
  const seg = h(
    "div",
    { class: "seg" },
    [
      ["tutti", `Tutti (${data.active.length})`],
      ["danger", `Critici (${c.danger})`],
      ["warning", `Da vedere (${c.warning})`],
      ["success", `Obiettivi (${c.success})`],
      ["info", `Info (${c.info})`],
    ].map(([k, l]) =>
      h(
        "button",
        {
          class: k === level ? "on" : "",
          onclick: (e) => {
            level = k;
            seg
              .querySelectorAll("button")
              .forEach((b) => b.classList.remove("on"));
            e.currentTarget.classList.add("on");
            draw();
          },
        },
        l,
      ),
    ),
  );
  draw();
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Alert"),
        h(
          "p",
          {},
          "Tutti gli alert attivi adesso, calcolati sulle soglie che hai impostato per ogni titolo",
        ),
      ),
      h("span", { class: "spacer" }),
      seg,
    ),
    h(
      "div",
      { class: "grid kpis", style: { marginBottom: "16px" } },
      kpi("Alert attivi", String(data.active.length), "tutti i livelli"),
      kpi(
        "Critici",
        String(c.danger),
        "da guardare subito",
        c.danger ? "down" : "",
      ),
      kpi(
        "Da vedere",
        String(c.warning),
        "attenzione",
        c.warning ? "warn" : "",
      ),
      kpi(
        "Obiettivi raggiunti",
        String(c.success),
        "target toccati",
        c.success ? "up" : "",
      ),
    ),
    box,
    h(
      "section",
      { class: "card", style: { marginTop: "18px" } },
      h("h2", {}, "Storico recente"),
      data.history.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              {},
              h(
                "tbody",
                {},
                data.history.map((x) =>
                  h(
                    "tr",
                    {},
                    h("td", {}, dateIt(x.day)),
                    h("td", {}, x.isin),
                    h(
                      "td",
                      {},
                      badge(
                        x.severity === "danger"
                          ? "critico"
                          : x.severity === "warning"
                            ? "da vedere"
                            : "obiettivo",
                        x.severity,
                      ),
                    ),
                    h("td", {}, x.message),
                  ),
                ),
              ),
            ),
          )
        : h(
            "div",
            { class: "empty" },
            "Lo storico si riempie man mano che gli alert scattano (controllo automatico ogni 10 minuti mentre il server è acceso).",
          ),
    ),
  );
}
