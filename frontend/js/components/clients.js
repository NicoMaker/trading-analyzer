// Clienti: capitale, acquisti a prezzo reale, allocazioni, stop loss / vendita forzata e andamento.
import { h, eur, num, pct, sign, dateIt, mount } from '../utils.js';
import { api } from '../api.js';
import { modal, confirmDialog, toast, field, input, select, formData, errorBox, loading, emptyRow, badge, kpi, alertBadges } from './ui.js';
import { perfCard } from './perf.js';
import { openBuyModal } from './trade.js';
import { store } from '../store.js';

const REASON = { manuale: 'venduta', stop_loss: 'stop loss', drawdown: 'perdita massima' };

export async function renderClients(view) {
  loading(view);
  let list;
  try { list = await api.get('/clients'); } catch (e) { mount(view, h('div', { class: 'form-error' }, e.message)); return; }
  const reload = () => renderClients(view);
  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Clienti'), h('p', {}, 'Imposta il capitale di ogni cliente, compra per lui e controlla rendite e rischio')),
      h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => openBuyModal({}, reload) }, '＋ Compra per cliente'), h('button', { class: 'btn primary', onclick: () => clientForm(null, reload) }, '+ Nuovo cliente')),
    h('div', { class: 'grid kpis', style: { marginBottom: '16px' } },
      kpi('Clienti', String(list.length), `${list.filter((c) => c.capital > 0).length} con capitale impostato`),
      kpi('Capitale totale', eur(list.reduce((a, c) => a + (c.capital || 0), 0)), `liquidità ${eur(list.reduce((a, c) => a + (c.cash || 0), 0))}`),
      kpi('Valore attuale', eur(list.reduce((a, c) => a + (c.value || 0), 0)), `investito ${eur(list.reduce((a, c) => a + (c.invested || 0), 0))}`),
      kpi('Utile/perdita', eur(list.reduce((a, c) => a + (c.pnl || 0), 0)), `realizzato ${eur(list.reduce((a, c) => a + (c.realized || 0), 0))}`, sign(list.reduce((a, c) => a + (c.pnl || 0), 0)))),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Cliente', 'Capitale', 'Liquidità', 'Investito', 'Valore attuale', 'Utile/perdita', 'Realizzato', 'Alert', ''].map((x, i) => h('th', { class: i >= 1 && i <= 6 ? 'num' : '' }, x)))),
      h('tbody', {}, list.length ? list.map((c) => h('tr', {},
        h('td', {}, h('a', { href: `#/client/${c.id}`, class: 'name' }, c.name), c.email && h('div', { class: 'sub' }, c.email)),
        h('td', { class: 'num' }, c.capital > 0 ? eur(c.capital) : h('span', { class: 'warn' }, 'da impostare')),
        h('td', { class: `num ${c.cash < 0 ? 'down' : ''}` }, eur(c.cash)), h('td', { class: 'num' }, eur(c.invested)), h('td', { class: 'num' }, eur(c.value)),
        h('td', { class: `num ${sign(c.pnl)}` }, eur(c.pnl), c.pnlPct != null && h('div', { class: 'sub' }, pct(c.pnlPct))),
        h('td', { class: `num ${sign(c.realized)}` }, eur(c.realized)),
        h('td', {}, c.alerts ? badge(`${c.alerts} alert`, 'warning') : h('span', { class: 'muted' }, '—')),
        h('td', {}, h('div', { class: 'actions' }, h('a', { class: 'btn sm', href: `#/client/${c.id}` }, 'Apri'),
          h('button', { class: 'btn sm', onclick: () => openBuyModal({ clientId: c.id }, reload) }, 'Compra'),
          h('button', { class: 'btn sm', onclick: () => clientForm(c, reload) }, 'Modifica'))))) : emptyRow(9, 'Nessun cliente. Premi "Nuovo cliente".')))));
}

function clientForm(c, onSaved) {
  const m = modal(c ? 'Modifica cliente' : 'Nuovo cliente', { narrow: true });
  const v = (k) => (c && c[k] ? c[k] : '');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); err.hide();
    try { const d = formData(form); if (c) await api.put(`/clients/${c.id}`, d); else await api.post('/clients', d); m.close(); toast('Cliente salvato', d.name, 'success'); onSaved(); }
    catch (ex) { err.show(ex.message); }
  } },
  field('Nome', input('name', { required: true, value: c ? c.name : '', maxlength: 100 })),
  field('Email', input('email', { type: 'email', value: c ? c.email || '' : '' })),
  h('div', { class: 'form-section', style: { margin: '4px 0 0' } }, 'Capitale e rischio'),
  field('Capitale del cliente €', input('capital', { type: 'number', step: '0.01', min: 0, value: c ? c.capital : '', placeholder: 'es. 10000' }), 'È il tetto di quanto puoi investire per lui'),
  field('Stop loss standard %', input('defaultStopPct', { type: 'number', step: 'any', min: 0, max: 99, value: v('defaultStopPct') }), 'Ogni nuovo acquisto viene venduto da solo se perde questa %'),
  field('Perdita massima sul capitale %', input('maxDrawdownPct', { type: 'number', step: 'any', min: 0, max: 99, value: v('maxDrawdownPct') }), 'Se il patrimonio scende oltre questa %, si vende tutto in automatico'),
  field('Note', h('textarea', { name: 'notes' }, c ? c.notes || '' : '')),
  h('div', { class: 'modal-foot' },
    c && h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog('Eliminare il cliente?', `${c.name}: le sue allocazioni verranno eliminate.`, { okLabel: 'Elimina' }))) return;
      try { await api.del(`/clients/${c.id}`); m.close(); toast('Cliente eliminato', '', 'success'); onSaved(); } catch (e) { toast('Errore', e.message, 'danger'); }
    } }, 'Elimina'),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Annulla'), h('button', { class: 'btn primary', type: 'submit' }, 'Salva')));
  m.body.append(form);
  const err = errorBox(form);
}

const statusBadge = (x) => x.status === 'open' ? badge('aperta', 'success') : badge(`${REASON[x.exitReason] || 'chiusa'}${x.closedAt ? ' · ' + dateIt(x.closedAt.slice(0, 10)) : ''}`, x.exitReason === 'manuale' ? 'neutral' : 'danger');

export async function renderClientDetail(view, id) {
  loading(view);
  let d, summary;
  try { [d, summary] = await Promise.all([api.get(`/clients/${id}`), api.get('/clients/allocations/summary')]); }
  catch (e) { mount(view, h('div', { class: 'form-error' }, e.message, ' ', h('a', { href: '#/clients' }, 'Torna ai clienti'))); return; }
  const reload = () => renderClientDetail(view, id);
  const t = d.totals, c = d.client;
  const used = c.capital > 0 ? Math.min(100, (t.invested / c.capital) * 100) : 0;
  const limit = c.maxDrawdownPct && c.capital > 0 ? c.capital * (1 - c.maxDrawdownPct / 100) : null;

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('a', { href: '#/clients', class: 'muted' }, '← Clienti'), h('h1', {}, c.name), c.email && h('p', {}, c.email)),
      h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => clientForm(c, reload) }, 'Capitale e rischio'),
      h('button', { class: 'btn', disabled: !summary.length, onclick: () => allocationForm(c, t.cash, summary, null, reload) }, '+ Assegna importo'),
      h('button', { class: 'btn primary', onclick: () => openBuyModal({ clientId: c.id }, reload) }, '＋ Compra per il cliente')),
    !(c.capital > 0) && h('div', { class: 'banner' }, '⚠ Capitale non impostato: premi "Capitale e rischio" per decidere quanto può investire questo cliente.'),
    h('div', { class: 'grid kpis' },
      kpi('Capitale', eur(c.capital), c.defaultStopPct ? `stop standard -${num(c.defaultStopPct, 1)}%` : 'nessuno stop standard'),
      kpi('Liquidità (può investire)', eur(t.cash), h('div', { class: 'bar cap-bar' }, h('span', { style: { width: `${used}%` } })), t.cash < 0 ? 'down' : ''),
      kpi('Investito (aperte)', eur(t.invested), `${t.openCount} allocazioni`), kpi('Valore attuale', eur(t.value)),
      kpi('Utile/perdita aperte', eur(t.pnl), t.pnlPct != null ? pct(t.pnlPct) : '', sign(t.pnl)),
      kpi('Realizzato (vendite)', eur(t.realized), `${t.closedCount} chiuse`, sign(t.realized)),
      kpi('Patrimonio', eur(t.equity), t.totalPnlPct != null ? `${pct(t.totalPnlPct)} sul capitale` : '', sign(t.totalPnl))),
    limit != null && h('div', { class: `banner`, style: { marginTop: '14px', background: 'var(--info-bg)', color: 'var(--info)' } },
      `🛡 Perdita massima ${num(c.maxDrawdownPct, 1)}%: se il patrimonio scende sotto ${eur(limit)} tutte le posizioni vengono vendute in automatico.`),
    h('div', { style: { marginTop: '14px' } }, perfCard('Andamento e rendite del cliente', `cl${store.ownerId}-${id}`, (days) => api.get(`/clients/${id}/performance?days=${days}`), { baseLabel: 'Investito' })),
    h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, h('table', {},
      h('thead', {}, h('tr', {}, ['Titolo', 'Stato', 'Importo €', 'Ingresso €', 'Quote', 'Prezzo €', 'Valore €', 'Utile/perdita', 'Stop', 'Alert', ''].map((x, i) => h('th', { class: i >= 2 && i <= 7 ? 'num' : '' }, x)))),
      h('tbody', {}, d.holdings.length ? d.holdings.map((x) => h('tr', { style: x.status === 'closed' ? { opacity: .78 } : {} },
        h('td', {}, h('div', { class: 'name' }, x.name), h('div', { class: 'sub' }, `${x.ticker || ''} ${x.isin}`), x.note && h('div', { class: 'sub' }, x.note)),
        h('td', {}, statusBadge(x)),
        h('td', { class: 'num' }, eur(x.euro)), h('td', { class: 'num' }, num(x.entryPriceEur, 4)), h('td', { class: 'num' }, num(x.units, 4)),
        h('td', { class: 'num' }, num(x.status === 'closed' ? x.exitPriceEur : x.currentPriceEur, 4)), h('td', { class: 'num' }, eur(x.value)),
        h('td', { class: `num ${sign(x.pnl)}` }, eur(x.pnl), x.pnlPct != null && h('div', { class: 'sub' }, pct(x.pnlPct))),
        h('td', {}, x.stopLossPct ? `-${num(x.stopLossPct, 1)}%` : '—'),
        h('td', {}, alertBadges(x.alerts, 2)),
        h('td', {}, h('div', { class: 'actions' },
          x.status === 'open' && h('button', { class: 'btn sm danger', onclick: async () => {
            if (!(await confirmDialog('Vendere al prezzo attuale?', `${x.name}: ${eur(x.euro)} assegnati. L'incasso torna nella liquidità del cliente.`, { okLabel: 'Vendi' }))) return;
            try { const r = await api.post(`/trade/close/${x.id}`); toast('Venduto', `Incassati ${eur(r.proceeds)} (${pct(r.pnlPct)})`, r.pnl >= 0 ? 'success' : 'warning'); reload(); } catch (e) { toast('Vendita non eseguita', e.message, 'danger'); }
          } }, 'Vendi'),
          x.status === 'open' && h('button', { class: 'btn sm', onclick: () => allocationForm(c, t.cash, summary, x, reload) }, 'Modifica'),
          h('button', { class: 'btn sm danger', 'aria-label': 'Elimina', onclick: async () => {
            if (!(await confirmDialog('Eliminare la riga?', `${eur(x.euro)} su ${x.name}${x.status === 'closed' ? ': verrà cancellato anche il risultato realizzato.' : '.'}`, { okLabel: 'Elimina' }))) return;
            try { await api.del(`/clients/allocations/${x.id}`); toast('Allocazione eliminata', '', 'success'); reload(); } catch (e) { toast('Errore', e.message, 'danger'); }
          } }, '🗑'))))) : emptyRow(11, 'Nessun importo assegnato a questo cliente. Premi "Compra per il cliente".')))),
    h('p', { class: 'disclaimer' }, 'Liquidità = capitale − importi assegnati + incassi delle vendite. Valore = importo × (prezzo EUR attuale ÷ prezzo EUR d\'ingresso). Lo stop loss e la perdita massima vendono in automatico solo con prezzi reali aggiornati. Grafici: cambi attuali applicati allo storico.'));
}

function allocationForm(client, cash, summary, a, onSaved) {
  const editing = !!a;
  const m = modal(editing ? 'Modifica allocazione' : `Assegna importo a ${client.name}`, { narrow: true });
  const sel = select('isin', summary.map((s) => [s.isin, s.name]), a ? a.isin : summary[0].isin, { disabled: editing });
  const hint = h('div', { class: 'muted', style: { fontSize: '12px' } });
  const upd = () => {
    const s = summary.find((x) => x.isin === sel.value);
    mount(hint, [`Il cliente può investire ancora `, h('b', { class: cash < 0 ? 'down' : '' }, eur(cash)), s ? ` · titolo: costo ${eur(s.cost)}, già assegnati ${eur(s.allocated)}` : '']);
  };
  sel.addEventListener('change', upd); upd();
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); err.hide();
    try {
      const d = formData(form); if (editing) d.isin = a.isin;
      if (editing) await api.put(`/clients/allocations/${a.id}`, d); else await api.post(`/clients/${client.id}/allocations`, d);
      m.close(); toast('Allocazione salvata', '', 'success'); onSaved();
    } catch (ex) { err.show(ex.message); }
  } },
  field('Titolo', sel), hint,
  field('Importo EUR', input('euro', { type: 'number', step: '0.01', min: 0.01, required: true, value: a ? a.euro : '' })),
  field('Prezzo di ingresso EUR (facoltativo)', input('entryPriceEur', { type: 'number', step: 'any', min: 0, value: a && a.entryPriceEur ? a.entryPriceEur : '' }), 'Vuoto = prezzo attuale'),
  field('Stop loss % (facoltativo)', input('stopLossPct', { type: 'number', step: 'any', min: 0, max: 99, value: a && a.stopLossPct ? a.stopLossPct : '' }), 'Vuoto = standard del cliente'),
  field('Nota', input('note', { value: a ? a.note || '' : '', maxlength: 300 })),
  h('div', { class: 'modal-foot' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Annulla'), h('button', { class: 'btn primary', type: 'submit' }, 'Salva')));
  m.body.append(form);
  const err = errorBox(form);
}

// Area del cliente (sola lettura). Con { as } l'admin vede la piattaforma di quel cliente.
export async function renderClientArea(view, { as = null, onName } = {}) {
  loading(view);
  const q = as ? `?as=${as}` : '';
  let d;
  try { d = await api.get(`/me/portfolio${q}`); } catch (e) { mount(view, h('div', { class: 'form-error' }, e.message)); return; }
  onName && onName(d.client.name);
  const t = d.totals;
  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Ciao ${d.client.name}`), h('p', {}, 'Il tuo portafoglio, aggiornato in diretta'))),
    h('div', { class: 'grid kpis' }, kpi('Capitale', eur(t.capital)), kpi('Liquidità', eur(t.cash)), kpi('Investito', eur(t.invested)), kpi('Valore attuale', eur(t.value)),
      kpi('Utile/perdita', eur(t.pnl), t.pnlPct != null ? pct(t.pnlPct) : '', sign(t.pnl)), kpi('Patrimonio', eur(t.equity), t.totalPnlPct != null ? `${pct(t.totalPnlPct)} sul capitale` : '', sign(t.totalPnl))),
    h('div', { style: { marginTop: '14px' } }, perfCard('Le mie rendite', `me${as || ''}`, (days) => api.get(`/me/performance?days=${days}${as ? `&as=${as}` : ''}`), { baseLabel: 'Investito' })),
    h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, h('table', {},
      h('thead', {}, h('tr', {}, ['Titolo', 'Stato', 'Investito €', 'Valore €', 'Utile/perdita', 'Dal'].map((x, i) => h('th', { class: i >= 2 && i <= 4 ? 'num' : '' }, x)))),
      h('tbody', {}, d.holdings.length ? d.holdings.map((x) => h('tr', {},
        h('td', {}, h('div', { class: 'name' }, x.name), h('div', { class: 'sub' }, x.isin)), h('td', {}, statusBadge(x)), h('td', { class: 'num' }, eur(x.euro)), h('td', { class: 'num' }, eur(x.value)),
        h('td', { class: `num ${sign(x.pnl)}` }, eur(x.pnl), x.pnlPct != null && h('div', { class: 'sub' }, pct(x.pnlPct))), h('td', {}, dateIt((x.createdAt || '').slice(0, 10))))) : emptyRow(6, 'Nessun investimento assegnato.')))),
    h('p', { class: 'disclaimer' }, 'Valori indicativi basati su quotazioni di mercato, prima delle imposte. Non costituiscono consulenza.'));
}
