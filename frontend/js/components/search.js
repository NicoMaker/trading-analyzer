// Ricerca titoli: aperta senza testo mostra TUTTI i titoli (portafoglio + aziende quotate) con prezzo reale;
// scrivendo si filtra per nome, ticker o ISIN (anche su tutto Yahoo Finance).
import { h, num, pct, sign, debounce } from '../utils.js';
import { api } from '../api.js';
import { modal, input, badge } from './ui.js';

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export function openSearch(onPick, initial = '', { title = 'Cerca titolo' } = {}) {
  let timer = null;
  const m = modal(title, { onClose: () => clearInterval(timer) });
  const list = h('div', { class: 'pick-list', role: 'listbox' });
  const info = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } });
  const q = input('q', { placeholder: 'Nome, ticker o ISIN — lascia vuoto per vedere tutti i titoli', value: initial, autocomplete: 'off' });
  let seq = 0;

  const row = (r, text) => h('button', { type: 'button', class: 'pick-item', role: 'option', onclick: () => { m.close(); onPick({ ...r, isin: ISIN_RE.test(text.toUpperCase()) ? text.toUpperCase() : null }); } },
    h('span', { class: 'sym' }, r.symbol),
    h('span', { class: 'grow' }, h('div', {}, r.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, [r.exchange, r.sector || r.type].filter(Boolean).join(' · '))),
    r.inPortfolio && badge('in portafoglio', 'info'),
    h('span', { class: 'px' }, r.price != null ? `${num(r.price)} ${r.currency || ''}` : '—',
      r.dayChangePct != null && h('div', { class: sign(r.dayChangePct), style: { fontSize: '12px' } }, pct(r.dayChangePct))));

  const go = async (quiet = false) => {
    const text = q.value.trim(), my = ++seq;
    if (!quiet) list.replaceChildren(h('div', { class: 'muted pad' }, 'Carico titoli e prezzi reali…'));
    try {
      const rows = await api.get(`/market/search?q=${encodeURIComponent(text)}`);
      if (my !== seq) return;                                   // risposta vecchia: ignorata
      info.textContent = text ? `${rows.length} risultati per "${text}"` : `${rows.length} titoli — scrivi per filtrare`;
      list.replaceChildren(...(rows.length ? rows.map((r) => row(r, text)) : [h('div', { class: 'empty' }, 'Nessun risultato')]));
    } catch (e) { if (my === seq && !quiet) { info.textContent = ''; list.replaceChildren(h('div', { class: 'form-error' }, e.message)); } }
  };
  q.addEventListener('input', debounce(() => go(), 300));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m.body.append(q, info, list);
  q.focus();
  go();                                                         // subito: senza testo = tutti
  timer = setInterval(() => go(true), 45000);                   // prezzi sempre freschi mentre l'elenco e' aperto
}
