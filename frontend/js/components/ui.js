// Componenti di base riutilizzabili: toast, modale, conferma, badge, KPI, campi form.
import { h, clear } from '../utils.js';
import { store } from '../store.js';

// Durante gli aggiornamenti in diretta non si svuota la pagina (niente lampeggio e la posizione di scroll resta)
export const ui = { soft: false };

export function toast(title, message = '', kind = 'info', ms = 5000) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, h('b', {}, title), message && h('span', { class: 'muted' }, message));
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

// Modale: restituisce {el, body, close}. Chiude con Esc o click sullo sfondo.
export function modal(title, { narrow = false, onClose } = {}) {
  const body = h('div', { class: 'modal-body' });
  const overlay = h('div', { class: 'overlay' });
  // Blocca lo scroll della pagina sotto: scorre solo il contenuto della finestra
  document.body.classList.add('modal-open');
  const close = () => {
    document.removeEventListener('keydown', onKey); overlay.remove();
    if (!document.querySelector('.overlay')) { document.body.classList.remove('modal-open'); store.emit('modal-closed'); }
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.append(h('div', { class: `modal${narrow ? ' narrow' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost icon', 'aria-label': 'Chiudi', onclick: close }, '✕')),
    body));
  document.body.append(overlay);
  const first = overlay.querySelector('input,select,textarea');
  if (first) first.focus();
  return { el: overlay, body, close };
}

export function confirmDialog(title, message, { okLabel = 'Conferma', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const m = modal(title, { narrow: true, onClose: () => { if (!done) { done = true; resolve(false); } } });
    m.body.append(h('p', {}, message),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', onclick: () => finish(false) }, 'Annulla'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, okLabel)));
  });
}

export const badge = (text, kind = 'neutral', title) => h('span', { class: `badge ${kind}`, title }, text);

export function alertBadges(alerts, max = 3) {
  const list = (alerts || []).filter((a) => a.severity !== 'info');
  if (!list.length) return h('span', { class: 'muted' }, '—');
  const shown = list.slice(0, max).map((a) => badge(a.title, a.severity, a.message));
  if (list.length > max) shown.push(badge(`+${list.length - max}`, 'neutral', list.slice(max).map((a) => a.title).join(', ')));
  return h('div', { class: 'badges' }, shown);
}

// Icona del KPI scelta dal testo dell'etichetta (si puo' forzare con il quinto parametro)
const KPI_ICONS = [[/utile|perdita|rendimento|risultato/i, '±'], [/realizzat/i, '✓'], [/dividend/i, '％'], [/alert|critic/i, '⚑'], [/valore|patrimonio/i, '◆'],
  [/costo|investit|capitale|liquidit|importo/i, '€'], [/prezzo/i, '$'], [/quantit|titoli|posizion|operazion|utent|client|ammin|attiv|acquist|vendit|total/i, '#']];
export const kpi = (label, value, sub, cls = '', icon) =>
  h('div', { class: 'kpi' },
    h('div', { class: 'head' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, icon || (KPI_ICONS.find(([re]) => re.test(label)) || [0, '◈'])[1]), h('div', { class: 'label' }, label)),
    h('div', { class: `value ${cls}` }, value), sub != null && h('div', { class: 'sub' }, sub));

// Piccolo contatore accanto ai titoli di sezione
export const countPill = (n) => h('span', { class: 'count-pill' }, String(n));

export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export const input = (name, props = {}) => h('input', { name, ...props });
export const select = (name, options, value, props = {}) =>
  h('select', { name, ...props }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));

// Legge tutti i campi di un form in un oggetto (stringhe vuote restano vuote)
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

export function errorBox(form) {
  let box = form.querySelector('.form-error');
  if (!box) { box = h('div', { class: 'form-error hidden', role: 'alert' }); form.prepend(box); }
  return { show: (m) => { box.textContent = m; box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' }); }, hide: () => box.classList.add('hidden') };
}

export function loading(el, text = 'Caricamento…') { if (ui.soft) return; clear(el).append(h('div', { class: 'skeleton' }, text)); }
export function emptyRow(cols, text) { return h('tr', {}, h('td', { colspan: cols, class: 'empty' }, text)); }
