import { h } from './utils.js';
import { api } from './api.js';
import { store } from './store.js';
import { toast, ui } from './components/ui.js';
import { renderLogin } from './components/login.js';
import { renderShell, initTheme, loadOwners } from './components/navbar.js';
import { renderDashboard } from './components/dashboard.js';
import { renderPositions } from './components/positions.js';
import { renderStockDetail } from './components/stock-detail.js';
import { renderOperations } from './components/operations.js';
import { renderAlerts } from './components/alerts.js';
import { renderClients, renderClientDetail, renderClientArea } from './components/clients.js';
import { renderUsers, renderProfile } from './components/users.js';
import { renderGuide } from './components/guide.js';
import { initNotifications, refreshUnread } from './components/notifications.js';
import { connectSocket, disconnectSocket, watchOwner } from './socket.js';

const root = document.getElementById('app');
let shell = null, pollTimer = null, softTimer = null, pendingSoft = false, firstPoll = true;

initTheme();
initNotifications();

function showLogin(notice) {
  clearInterval(pollTimer); clearTimeout(softTimer); disconnectSocket();
  shell = null; store.user = null; store.unread = 0; firstPoll = true; pendingSoft = false;
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  document.body.classList.remove('modal-open');
  renderLogin(root, (user) => start(user), notice);
}

async function start(user) {
  store.user = user; store.ownerId = user.id;
  try { await loadOwners(); } catch { /* non bloccante */ }
  shell = renderShell(root, { onLogout: async () => { await api.post('/auth/logout').catch(() => {}); showLogin(); } });
  connectSocket();
  refreshUnread();
  if (!location.hash || location.hash === '#/') location.hash = user.role === 'cliente' ? '#/my' : '#/dashboard';
  route();
  if (user.mustChangePassword) toast('Cambia la password iniziale', 'Vai su "Il mio account" (menu in basso a sinistra)', 'warning', 9000);
  if (user.role !== 'cliente') { pollAlerts(); pollTimer = setInterval(pollAlerts, 60000); }
}

const routes = [
  [/^#\/dashboard$/, (v) => renderDashboard(v), ['admin', 'utente']],
  [/^#\/positions$/, (v) => renderPositions(v), ['admin', 'utente']],
  [/^#\/position\/(\d+)$/, (v, m) => renderStockDetail(v, parseInt(m[1], 10)), ['admin', 'utente']],
  [/^#\/operations$/, (v) => renderOperations(v), ['admin', 'utente']],
  [/^#\/alerts$/, (v) => renderAlerts(v), ['admin', 'utente']],
  [/^#\/clients$/, (v) => renderClients(v), ['admin', 'utente']],
  [/^#\/client\/(\d+)$/, (v, m) => renderClientDetail(v, parseInt(m[1], 10)), ['admin', 'utente']],
  [/^#\/users$/, (v) => renderUsers(v, { onRelogin: showLogin }), ['admin']],
  [/^#\/guide$/, (v) => renderGuide(v), ['admin', 'utente', 'cliente']],
  [/^#\/profile$/, (v) => renderProfile(v, { onRelogin: showLogin }), ['admin', 'utente', 'cliente']],
  [/^#\/my$/, (v) => renderClientArea(v), ['cliente']],
  [/^#\/as\/(\d+)$/, (v, m) => renderClientArea(v, { as: parseInt(m[1], 10), onName: (n) => shell && shell.setBanner(n) }), ['admin']],
];

// soft = aggiornamento in diretta: stessa pagina ricaricata senza svuotarla e senza perdere la posizione di scroll
function route({ soft = false } = {}) {
  if (!shell || !store.user) return;
  const hash = location.hash || '#/';
  for (const [re, fn, roles] of routes) {
    const m = hash.match(re);
    if (m && roles.includes(store.user.role)) {
      shell.setActive(hash); shell.setAlertCount(); shell.setBanner();
      const y = window.scrollY;
      if (!soft) { shell.view.scrollTo?.(0, 0); window.scrollTo(0, 0); }
      ui.soft = soft;
      let p;
      try { p = Promise.resolve(fn(shell.view, m)); } catch (e) { p = Promise.reject(e); }
      ui.soft = false;
      p.then(() => { if (soft) window.scrollTo(0, y); })
        .catch((e) => { if (!soft) shell.view.replaceChildren(h('div', { class: 'form-error' }, e.message)); });
      return;
    }
  }
  location.hash = store.user.role === 'cliente' ? '#/my' : '#/dashboard';
}
window.addEventListener('hashchange', () => route());

// ---- Tempo reale: quando il server segnala nuovi dati si aggiorna la pagina (mai mentre e' aperta una finestra/form) ----
function softRefresh() {
  if (!shell || !store.user) return;
  if (document.querySelector('.overlay')) { pendingSoft = true; return; }
  pendingSoft = false;
  route({ soft: true });
  if (store.user.role !== 'cliente') pollAlerts();
}
store.on('data-changed', () => { clearTimeout(softTimer); softTimer = setTimeout(softRefresh, 600); });
store.on('modal-closed', () => { if (pendingSoft) softRefresh(); });
store.on('owner-changed', () => { firstPoll = true; watchOwner(store.ownerId); route(); pollAlerts(); });

// Conteggio alert (campanella/menu). Gli avvisi a schermo arrivano in diretta dalle notifiche del server.
async function pollAlerts() {
  try {
    const d = await api.get('/alerts');
    store.alertCounts = d.counts; shell && shell.setAlertCount();
    if (firstPoll && d.counts.danger > 0) toast(`${d.counts.danger} alert critici`, 'Apri la sezione Alert per i dettagli', 'danger', 7000);
    firstPoll = false;
  } catch { /* la sessione scaduta e' gestita da session-expired */ }
}

// Sessione scaduta oppure credenziali cambiate da un'altra parte: fuori subito
store.on('session-expired', (msg) => { if (store.user) showLogin(msg || 'Sessione scaduta: rifai il login.'); });

(async function boot() {
  try { const r = await api.get('/auth/me'); await start(r.user); }
  catch { showLogin(); }
})();
