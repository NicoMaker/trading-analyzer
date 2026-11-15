// Struttura principale: barra laterale con menu per ruolo, selettore portafoglio (admin), tema e logout.
import { h } from '../utils.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { logo } from './login.js';
import { pref } from '../utils.js';
import { openNotifications, updateBell } from './notifications.js';

const STAFF = [
  ['#/dashboard', 'Dashboard', '▦'],
  ['#/positions', 'Titoli', '◈'],
  ['#/operations', 'Operazioni', '⇄'],
  ['#/alerts', 'Alert', '⚑'],
  ['#/clients', 'Clienti', '☺'],
];
const ADMIN = [['#/users', 'Utenti', '⚙']];
const GUIDE = [['#/guide', 'Guida', '?']];
const CLIENT = [['#/my', 'Il mio portafoglio', '▦']];

export function applyTheme(t) { document.documentElement.dataset.theme = t; pref.set('theme', t); }
export const initTheme = () => applyTheme(pref.get('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

// Cambia il portafoglio in uso (solo admin): tutte le viste si ricaricano su quell'utente
export function setOwner(id) { store.ownerId = id; store.emit('owners-changed'); store.emit('owner-changed'); }

export function renderShell(root, { onLogout }) {
  const u = store.user;
  const items = [...(u.role === 'cliente' ? CLIENT : [...STAFF, ...(u.role === 'admin' ? ADMIN : [])]), ...GUIDE];
  const links = items.map(([href, label, icon]) => h('a', { href, 'data-href': href }, h('span', { 'aria-hidden': 'true' }, icon), label,
    href === '#/alerts' ? h('span', { class: 'count hidden', id: 'alert-count' }) : null));

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, logo()), 'Trading Analyzer'),
    u.role === 'admin' && ownerSelect(),
    h('nav', { class: 'nav' }, links),
    h('div', { class: 'side-foot' },
      h('a', { href: '#/profile', class: 'muted' }, `👤 ${u.name}`, h('div', { class: 'sub muted', style: { fontSize: '12px' } }, `${u.username} · ${u.role}`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm bell', 'aria-label': 'Notifiche', onclick: openNotifications }, '🔔', h('span', { class: 'count hidden', id: 'notif-count' })),
        h('span', { class: 'muted', id: 'live-state', title: 'Aggiornamenti in diretta' }, h('i', { class: 'live-dot' }), 'live'),
        h('button', { class: 'btn sm', onclick: () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light') }, '◐ Tema'),
        h('button', { class: 'btn sm', onclick: onLogout }, 'Esci'))));

  const view = h('main', { class: 'main', id: 'view' });
  const banner = h('div', { class: 'as-banner hidden' });
  const menuBtn = h('button', { class: 'btn menu-btn', 'aria-label': 'Menu', onclick: () => sidebar.classList.toggle('open') }, '☰ Menu');
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });
  root.replaceChildren(h('div', { class: 'shell' }, sidebar, h('div', { style: { minWidth: 0 } }, menuBtn, h('div', { style: { padding: '14px 30px 0' } }, banner), view)));
  store.on('socket-state', (on) => { const d = document.querySelector('#live-state .live-dot'); if (d) d.classList.toggle('on', !!on); });
  updateBell();

  return {
    view,
    setActive(hash) {
      links.forEach((a) => a.classList.toggle('active', hash.startsWith(a.dataset.href) || (a.dataset.href === '#/positions' && hash.startsWith('#/position/')) || (a.dataset.href === '#/clients' && hash.startsWith('#/client/'))));
    },
    // Avviso quando l'admin lavora nella piattaforma di un altro utente
    setBanner(asUser) {
      const other = u.role === 'admin' && store.ownerId !== u.id ? store.owners.find((o) => o.id === store.ownerId) : null;
      banner.replaceChildren();
      if (asUser) banner.append(h('span', {}, `👁 Stai vedendo la piattaforma del cliente ${asUser}`), h('a', { class: 'btn sm', href: '#/users' }, '← Torna agli utenti'));
      else if (other) banner.append(h('span', {}, `👁 Stai operando nel portafoglio di ${other.name} (${other.username}): acquisti, vendite e clienti sono suoi`), h('button', { class: 'btn sm', onclick: () => setOwner(u.id) }, '← Torna al mio portafoglio'));
      banner.classList.toggle('hidden', !asUser && !other);
    },
    setAlertCount() {
      const el = document.getElementById('alert-count'); if (!el) return;
      const n = store.alertCounts.danger + store.alertCounts.warning;
      el.textContent = n; el.classList.toggle('hidden', n === 0);
    },
  };
}

function ownerSelect() {
  const sel = h('select', { 'aria-label': 'Portafoglio', onchange: () => setOwner(parseInt(sel.value, 10)) });
  const fill = () => {
    sel.replaceChildren(...store.owners.map((o) => h('option', { value: o.id, selected: o.id === store.ownerId }, `${o.name} (${o.username})`)));
  };
  fill();
  store.on('owners-changed', fill);
  return h('div', { class: 'field', style: { padding: '0 4px 12px' } }, h('label', {}, 'Portafoglio di'), sel);
}

export async function loadOwners() {
  if (store.user.role !== 'admin') return;
  store.owners = await api.get('/users/owners');
  if (!store.owners.some((o) => o.id === store.ownerId)) store.ownerId = store.user.id;
  store.emit('owners-changed');
}
