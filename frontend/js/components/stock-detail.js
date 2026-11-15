import { h, eur, num, pct, sign, dateTime, mount } from '../utils.js';
import { api } from '../api.js';
import { kpi, badge, loading, toast } from './ui.js';
import { lineChart, legend } from './chart.js';
import { alertList } from './dashboard.js';
import { openPositionForm } from './positions.js';

const RANGES = [['1M', 21], ['3M', 63], ['6M', 126], ['1A', 400]];

export async function renderStockDetail(view, id) {
  loading(view);
  let pf, an = null, anErr = null;
  try {
    pf = await api.get('/positions');
    const p0 = pf.positions.find((x) => x.id === id);
    if (p0 && p0.ticker) { try { an = await api.get(`/positions/${id}/analysis`); } catch (e) { anErr = e.message; } }
  } catch (e) { mount(view, h('div', { class: 'form-error' }, e.message)); return; }
  const p = pf.positions.find((x) => x.id === id);
  if (!p) { mount(view, h('div', { class: 'empty' }, 'Titolo non trovato. ', h('a', { href: '#/positions' }, 'Torna ai titoli'))); return; }

  const refresh = h('button', { class: 'btn', onclick: async () => {
    refresh.disabled = true;
    try { await api.get(`/positions/${id}/analysis?force=1`); toast('Dati aggiornati', p.name, 'success'); } catch (e) { toast('Aggiornamento non riuscito', e.message, 'danger'); }
    renderStockDetail(view, id);
  } }, '↻ Aggiorna');

  mount(view, 
    h('div', { class: 'page-head' },
      h('div', {}, h('a', { href: '#/positions', class: 'muted' }, '← Titoli'), h('h1', {}, p.name),
        h('p', {}, `${p.ticker || 'senza ticker'} · ${p.isin} · ${p.currency}${p.sector ? ' · ' + p.sector : ''}${an && an.exchange ? ' · ' + an.exchange : ''}`)),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => openPositionForm(p, () => renderStockDetail(view, id)) }, 'Modifica / soglie'), p.ticker && refresh),
    h('div', { class: 'grid kpis' },
      kpi('Prezzo', p.price != null ? `${num(p.price)} ${p.currency}` : 'n/d', p.dayChangePct != null ? `oggi ${pct(p.dayChangePct)}` : (p.quoteError || ''), sign(p.dayChangePct)),
      kpi('Quantità', num(p.quantity, 4), p.avgPrice != null ? `prezzo medio ${num(p.avgPrice)} €` : 'nessuna posizione aperta'),
      kpi('Valore', p.quantity > 0 ? eur(p.value) : '—', p.weight != null ? `peso ${num(p.weight, 1)}%${p.maxWeight ? ` (max ${num(p.maxWeight, 0)}%)` : ''}` : ''),
      kpi('Utile/perdita', p.quantity > 0 ? eur(p.pnl) : '—', p.pnlPct != null ? pct(p.pnlPct) : '', sign(p.pnl)),
      kpi('Realizzato', eur(p.realized), p.dividends ? `dividendi ${eur(p.dividends)}` : '', sign(p.realized))),
    p.alerts.length > 0 && h('section', { class: 'card', style: { marginTop: '14px' } }, h('h2', {}, 'Alert su questo titolo'), alertList(p.alerts.map((a) => ({ ...a, name: p.name })))),
    anErr && h('div', { class: 'banner', style: { marginTop: '14px' } }, `Analisi tecnica non disponibile: ${anErr}`),
    !p.ticker && h('div', { class: 'banner', style: { marginTop: '14px' } }, 'Imposta il ticker (Modifica) per vedere grafico e indicatori.'),
    an && an.analysis.enough && technical(an, p),
    p.notes && h('section', { class: 'card', style: { marginTop: '14px' } }, h('h2', {}, 'Note'), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, p.notes)),
    h('p', { class: 'disclaimer' }, 'I segnali tecnici sintetizzano indicatori storici: non sono previsioni né consigli di investimento.'));
}

function technical(an, p) {
  const a = an.analysis, v = a.values, S = a.series;
  const state = { range: 126, sma20: false, sma50: true, sma200: true, bb: false };
  const priceBox = h('div', {}), rsiBox = h('div', {}), macdBox = h('div', {});

  const tail = (arr, n) => arr.slice(Math.max(0, arr.length - n));
  const draw = () => {
    const n = state.range, t = tail(S.t, n);
    const series = [{ name: 'Prezzo', values: tail(S.close, n), color: 'var(--text)', width: 2 }];
    if (state.sma20) series.push({ name: 'Media 20', values: tail(S.sma20, n), color: '#f59e0b', width: 1.4 });
    if (state.sma50) series.push({ name: 'Media 50', values: tail(S.sma50, n), color: '#38bdf8', width: 1.4 });
    if (state.sma200) series.push({ name: 'Media 200', values: tail(S.sma200, n), color: '#c084fc', width: 1.4 });
    const guides = [];
    if (p.stopPrice != null) guides.push({ value: p.stopPrice, label: `Stop ${num(p.stopPrice)}`, color: 'var(--down)' });
    if (p.targetPrice != null) guides.push({ value: p.targetPrice, label: `Obiettivo ${num(p.targetPrice)}`, color: 'var(--up)' });
    priceBox.replaceChildren(lineChart({ times: t, series, guides, height: 330, band: state.bb ? { upper: tail(S.bbUpper, n), lower: tail(S.bbLower, n) } : null }),
      legend(series.map((s) => ({ name: s.name, color: s.color }))));
    rsiBox.replaceChildren(lineChart({ times: t, series: [{ name: 'RSI 14', values: tail(S.rsi, n), color: '#f472b6' }], height: 170, width: 520, yMin: 0, yMax: 100,
      guides: [{ value: p.rsiHigh ?? 70, label: 'ipercomprato', color: 'var(--warn)' }, { value: p.rsiLow ?? 30, label: 'ipervenduto', color: 'var(--info)' }], format: (x) => x.toFixed(0) }));
    macdBox.replaceChildren(lineChart({ times: t, series: [{ name: 'MACD', values: tail(S.macd, n), color: '#34d399' }, { name: 'Segnale', values: tail(S.macdSignal, n), color: '#fb923c' }], height: 170, width: 520, guides: [{ value: 0, label: '0', color: 'var(--muted)' }] }));
  };
  const rangeSeg = h('div', { class: 'seg' }, RANGES.map(([l, n]) => h('button', { class: n === state.range ? 'on' : '', onclick: (e) => {
    state.range = n; rangeSeg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
  } }, l)));
  const toggle = (label, key) => h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; draw(); } }), label);
  draw();

  const trendKind = a.trend === 'Rialzista' ? 'success' : a.trend === 'Ribassista' ? 'danger' : 'neutral';
  const row = (k, val, extra) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, val), h('td', { class: 'muted' }, extra || ''));
  return h('div', {},
    h('section', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'row', style: { marginBottom: '10px' } }, h('h2', {}, 'Andamento'), h('span', { class: 'spacer' }),
        toggle('Media 20', 'sma20'), toggle('Media 50', 'sma50'), toggle('Media 200', 'sma200'), toggle('Bollinger', 'bb'), rangeSeg),
      priceBox,
      an.stale && h('p', { class: 'warn' }, 'Dati non aggiornati: l\'API non risponde, mostrato l\'ultimo scaricamento.'),
      h('p', { class: 'muted', style: { margin: '8px 0 0', fontSize: '12px' } }, `Ultima quotazione: ${dateTime(an.marketTime)} · Yahoo Finance`)),
    h('div', { class: 'grid two', style: { marginTop: '14px' } },
      h('section', { class: 'card' }, h('h2', {}, 'RSI (14)'), rsiBox),
      h('section', { class: 'card' }, h('h2', {}, 'MACD (12, 26, 9)'), macdBox)),
    h('div', { class: 'grid two', style: { marginTop: '14px' } },
      h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', {}, 'Segnali'), h('span', { class: 'spacer' }), badge(a.trend, trendKind)),
        h('div', { class: 'ranked', style: { marginTop: '8px' } }, a.signals.map((s) => h('div', { class: 'signal' },
          badge(s.score > 0 ? 'rialzista' : s.score < 0 ? 'ribassista' : 'neutro', s.score > 0 ? 'success' : s.score < 0 ? 'danger' : 'neutral'),
          h('div', {}, h('b', {}, s.label), h('div', { class: 'muted' }, s.detail)))))),
      h('section', { class: 'card' }, h('h2', {}, 'Indicatori'),
        h('table', {}, h('tbody', {},
          row('Media 20 / 50 / 200', `${num(v.sma20)} / ${num(v.sma50)} / ${num(v.sma200)}`),
          row('RSI 14', num(v.rsi, 1)),
          row('Bollinger (20, 2)', `${num(v.bbLower)} – ${num(v.bbUpper)}`),
          row('ATR 14', num(v.atr), v.atrPct != null ? `${num(v.atrPct, 1)}% del prezzo` : ''),
          row('Volatilità annua', v.volatility != null ? `${num(v.volatility, 1)}%` : '—'),
          row('Max drawdown (1 anno)', `${num(v.maxDrawdown, 1)}%`),
          row('Massimo / minimo 52 sett.', `${num(v.high52)} / ${num(v.low52)}`, `${pct(v.fromHigh52, 1)} dal massimo`),
          row('Performance 1M / 3M / 6M', `${pct(v.perf1m, 1)} / ${pct(v.perf3m, 1)} / ${pct(v.perf6m, 1)}`),
          row('Performance 1 anno', pct(v.perf1y, 1)))))));
}
