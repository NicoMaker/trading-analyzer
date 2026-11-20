// Guida di utilizzo: sezioni numerate con indice laterale, filtrate in base al ruolo.
import { h, mount } from "../utils.js";
import { store } from "../store.js";
import { GUIDE } from "../guide-data.js";

const ROLE_LABEL = {
  admin: "Amministratore",
  utente: "Utente",
  cliente: "Cliente",
};

// **testo** diventa grassetto; il resto e' sempre testo semplice (nessun HTML dai dati)
function rich(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith("**") ? h("b", {}, p.slice(2, -2)) : p));
}

export function renderGuide(view) {
  const role = store.user.role;
  const sections = GUIDE.filter((s) => s.roles.includes(role));
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Guida di utilizzo"),
        h(
          "p",
          {},
          `${sections.length} sezioni per il ruolo ${ROLE_LABEL[role]}: segui i passi numerati`,
        ),
      ),
      h("span", { class: "spacer" }),
      h("button", { class: "btn", onclick: () => window.print() }, "🖨 Stampa"),
    ),
    h(
      "div",
      { class: "guide" },
      h(
        "nav",
        { class: "toc", "aria-label": "Indice" },
        sections.map((s) =>
          h(
            "a",
            {
              href: `#/guide`,
              onclick: (e) => {
                e.preventDefault();
                document
                  .getElementById(`g-${s.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
            },
            s.title,
          ),
        ),
      ),
      h(
        "div",
        { class: "g-sections" },
        sections.map((s) =>
          h(
            "section",
            { class: "card g-sec", id: `g-${s.id}` },
            h(
              "div",
              { class: "g-title" },
              h("h2", {}, s.title),
              s.roles.length < 3 &&
                s.roles.map((r) =>
                  h("span", { class: "role-tag" }, ROLE_LABEL[r]),
                ),
            ),
            h("p", { class: "lead" }, s.lead),
            h(
              "ol",
              { class: "g-steps" },
              s.steps.map((t) => h("li", {}, rich(t))),
            ),
            s.tip &&
              h(
                "div",
                { class: `g-tip${s.warn ? " warn" : ""}` },
                h("b", {}, s.warn ? "Attenzione: " : "Suggerimento: "),
                rich(s.tip),
              ),
          ),
        ),
      ),
    ),
  );
}
