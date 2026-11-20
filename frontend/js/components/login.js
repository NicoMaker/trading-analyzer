import { h } from "../utils.js";
import { api } from "../api.js";

export function renderLogin(root, onLogged, notice) {
  root.replaceChildren();
  const err = h("div", { class: "form-error hidden", role: "alert" });
  const user = h("input", {
    name: "username",
    autocomplete: "username",
    required: true,
    autofocus: true,
    placeholder: "Nome utente",
  });
  const pass = h("input", {
    name: "password",
    type: "password",
    autocomplete: "current-password",
    required: true,
    placeholder: "Password",
  });
  const btn = h(
    "button",
    {
      class: "btn primary",
      type: "submit",
      style: { justifyContent: "center", width: "100%" },
    },
    "Accedi",
  );
  const form = h(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        err.classList.add("hidden");
        btn.disabled = true;
        try {
          const r = await api.post("/auth/login", {
            username: user.value.trim(),
            password: pass.value,
          });
          onLogged(r.user);
        } catch (ex) {
          err.textContent = ex.message;
          err.classList.remove("hidden");
          pass.select();
        } finally {
          btn.disabled = false;
        }
      },
    },
    err,
    h("div", { class: "field" }, h("label", { for: "lu" }, "Utente"), user),
    h("div", { class: "field" }, h("label", { for: "lp" }, "Password"), pass),
    btn,
  );
  user.id = "lu";
  pass.id = "lp";
  root.append(
    h(
      "div",
      { class: "login-wrap" },
      h(
        "div",
        { class: "login-card" },
        h(
          "div",
          { class: "brand" },
          h("span", { class: "brand-mark" }, logo()),
          "Trading Analyzer",
        ),
        h(
          "p",
          { class: "muted", style: { margin: "0 0 18px" } },
          "Analisi del portafoglio, alert e clienti con quotazioni reali.",
        ),
        notice && h("div", { class: "banner" }, notice),
        form,
      ),
    ),
  );
}

export function logo() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", "M6 21l6-7 5 4 9-10");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "#fff");
  p.setAttribute("stroke-width", "3");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}
