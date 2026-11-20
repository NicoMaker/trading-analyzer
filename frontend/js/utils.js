// Costruttore DOM minimale: h('div', {class:'x', onclick: fn}, figli...). Il testo e' sempre inserito come
// textContent, quindi non si puo' iniettare HTML dai dati.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected")
      el[k] = !!v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
// Come replaceChildren ma ignora null/false (altrimenti il browser li scrive come testo)
export function mount(el, ...children) {
  el.replaceChildren(
    ...children.flat(Infinity).filter((c) => c != null && c !== false),
  );
  return el;
}
export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};

const nf = (d) =>
  new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const cache = {};
const f = (d) => cache[d] || (cache[d] = nf(d));
export const num = (v, d = 2) =>
  v == null || !isFinite(v) ? "—" : f(d).format(v);
export const eur = (v, d = 2) =>
  v == null || !isFinite(v) ? "—" : `${f(d).format(v)} €`;
export const pct = (v, d = 2) =>
  v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${f(d).format(v)}%`;
export const sign = (v) =>
  v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "";
export const today = () => new Date().toISOString().slice(0, 10);
export const dateIt = (s) => (s ? s.split("-").reverse().join("/") : "—");
export const dateTime = (ms) =>
  ms
    ? new Date(ms).toLocaleString("it-IT", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

export function debounce(fn, ms = 350) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Preferenze leggere (tema): il browser puo' bloccare lo storage, quindi sempre in try/catch
export const pref = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignora */
    }
  },
};
