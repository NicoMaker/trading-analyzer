// Grafico a linee in SVG puro (nessuna libreria esterna): serie multiple, assi, linee guida e tooltip.
import { h } from '../utils.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * lineChart({ times:[ms], series:[{name, values, color, dash, width}], height, guides:[{value,label,color}], band:{upper,lower},
 *             format:(v)=>string, yMin, yMax })
 */
export function lineChart({ times, series, height = 320, guides = [], band, format = (v) => v.toFixed(2), yMin, yMax, width = 900 }) {
  const W = width, H = height, pad = { l: 62, r: 14, t: 12, b: 26 };
  const wrap = h('div', { class: 'chart' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Grafico' });
  wrap.append(svg);

  const vals = [];
  for (const sr of series) for (const v of sr.values) if (v != null) vals.push(v);
  if (band) for (const v of [...band.upper, ...band.lower]) if (v != null) vals.push(v);
  for (const g of guides) if (g.value != null) vals.push(g.value);
  if (!vals.length || times.length < 2) { wrap.append(h('div', { class: 'empty' }, 'Dati insufficienti')); return wrap; }
  let lo = yMin != null ? yMin : Math.min(...vals), hi = yMax != null ? yMax : Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const margin = (hi - lo) * 0.06;
  if (yMin == null) lo -= margin; if (yMax == null) hi += margin;

  const n = times.length;
  const x = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const css = (name) => `var(--${name})`;

  // griglia + etichette asse Y
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4, yy = y(v);
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: css('line'), 'stroke-width': 1 }));
    const t = s('text', { x: pad.l - 8, y: yy + 4, 'text-anchor': 'end', fill: css('muted'), 'font-size': 11 }); t.textContent = format(v); svg.append(t);
  }
  // etichette asse X (5 date)
  for (let i = 0; i < 5; i++) {
    const idx = Math.round((i * (n - 1)) / 4);
    const t = s('text', { x: x(idx), y: H - 7, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', fill: css('muted'), 'font-size': 11 });
    t.textContent = new Date(times[idx]).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }); svg.append(t);
  }
  const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };

  if (band) {
    const up = band.upper, lw = band.lower; const pts = [];
    for (let i = 0; i < n; i++) if (up[i] != null) pts.push(`${x(i).toFixed(1)},${y(up[i]).toFixed(1)}`);
    for (let i = n - 1; i >= 0; i--) if (lw[i] != null) pts.push(`${x(i).toFixed(1)},${y(lw[i]).toFixed(1)}`);
    svg.append(s('polygon', { points: pts.join(' '), fill: css('info'), opacity: 0.08 }));
  }
  for (const g of guides) {
    if (g.value == null || g.value < lo || g.value > hi) continue;
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(g.value), y2: y(g.value), stroke: g.color, 'stroke-dasharray': '6 4', 'stroke-width': 1.3 }));
    const t = s('text', { x: W - pad.r - 4, y: y(g.value) - 4, 'text-anchor': 'end', fill: g.color, 'font-size': 11, 'font-weight': 600 }); t.textContent = g.label; svg.append(t);
  }
  for (const sr of series) {
    svg.append(s('path', { d: path(sr.values), fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 1.8, 'stroke-dasharray': sr.dash || '', 'stroke-linejoin': 'round' }));
  }

  // tooltip con mirino
  const cross = s('line', { y1: pad.t, y2: H - pad.b, stroke: css('muted'), 'stroke-width': 1, opacity: 0 });
  svg.append(cross);
  const tip = h('div', { class: 'tip', style: { display: 'none' } });
  wrap.append(tip);
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    tip.style.display = 'block';
    tip.style.left = `${(x(i) / W) * r.width}px`; tip.style.top = `${(y(series[0].values[i] ?? lo) / H) * r.height}px`;
    tip.replaceChildren(h('b', {}, new Date(times[i]).toLocaleDateString('it-IT', { dateStyle: 'medium' })),
      ...series.filter((sr) => sr.values[i] != null).map((sr) => h('div', {}, h('span', { style: { color: sr.color } }, '● '), `${sr.name}: ${format(sr.values[i])}`)));
  });
  svg.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); tip.style.display = 'none'; });
  return wrap;
}

export const legend = (items) => h('div', { class: 'legend' }, items.map((i) => h('span', {}, h('i', { style: { background: i.color } }), i.name)));
