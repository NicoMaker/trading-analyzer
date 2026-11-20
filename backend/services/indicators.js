// Indicatori tecnici calcolati su serie di chiusure giornaliere. Tutte le funzioni restituiscono
// array allineati alla serie di input (null dove l'indicatore non e' ancora calcolabile).

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI di Wilder
function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const calc = () =>
    loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  out[n] = calc();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n;
    loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = calc();
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalN = 9) {
  const ef = ema(values, fast),
    es = ema(values, slow);
  const line = values.map((_, i) =>
    ef[i] != null && es[i] != null ? ef[i] - es[i] : null,
  );
  const firstIdx = line.findIndex((v) => v != null);
  const signal = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const tail = ema(line.slice(firstIdx), signalN);
    tail.forEach((v, i) => {
      signal[firstIdx + i] = v;
    });
  }
  const hist = line.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null,
  );
  return { line, signal, hist };
}

function bollinger(values, n = 20, mult = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

function atr(candles, n = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= n) return out;
  const tr = candles.map((c, i) =>
    i === 0
      ? c.h - c.l
      : Math.max(
          c.h - c.l,
          Math.abs(c.h - candles[i - 1].c),
          Math.abs(c.l - candles[i - 1].c),
        ),
  );
  let prev = tr.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  out[n] = prev;
  for (let i = n + 1; i < candles.length; i++) {
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

function annualizedVolatility(values) {
  if (values.length < 3) return null;
  const r = [];
  for (let i = 1; i < values.length; i++)
    r.push(Math.log(values[i] / values[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

function maxDrawdown(values) {
  let peak = -Infinity,
    dd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    dd = Math.min(dd, v / peak - 1);
  }
  return dd * 100;
}

const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
const lastDefined = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
};
const perf = (closes, bars) =>
  closes.length > bars
    ? (closes[closes.length - 1] / closes[closes.length - 1 - bars] - 1) * 100
    : null;

// Analisi completa: valori correnti, serie per i grafici e un riepilogo dei segnali.
function analyze(candles) {
  const closes = candles.map((c) => c.c);
  if (closes.length < 2) return { enough: false };

  const s20 = sma(closes, 20),
    s50 = sma(closes, 50),
    s200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const a = atr(candles, 14);
  const price = last(closes);
  const hi = Math.max(...candles.map((c) => c.h));
  const lo = Math.min(...candles.map((c) => c.l));

  const v = {
    price,
    sma20: last(s20),
    sma50: last(s50),
    sma200: last(s200),
    rsi: last(r),
    macd: last(m.line),
    macdSignal: last(m.signal),
    macdHist: last(m.hist),
    bbUpper: last(bb.upper),
    bbLower: last(bb.lower),
    bbMid: last(bb.mid),
    atr: last(a),
    atrPct: last(a) != null ? (last(a) / price) * 100 : null,
    volatility: annualizedVolatility(closes),
    maxDrawdown: maxDrawdown(closes),
    high52: hi,
    low52: lo,
    fromHigh52: (price / hi - 1) * 100,
    fromLow52: (price / lo - 1) * 100,
    perf1m: perf(closes, 21),
    perf3m: perf(closes, 63),
    perf6m: perf(closes, 126),
    perf1y: perf(closes, closes.length - 1),
  };

  // Segnali: ogni voce vale +1 (rialzista), -1 (ribassista) o 0 (neutro). Strumento di lettura, non una raccomandazione.
  const signals = [];
  const add = (label, score, detail) => signals.push({ label, score, detail });
  if (v.sma50 != null)
    add(
      "Prezzo vs media 50",
      price > v.sma50 ? 1 : -1,
      price > v.sma50
        ? "sopra la media a 50 giorni"
        : "sotto la media a 50 giorni",
    );
  if (v.sma200 != null)
    add(
      "Prezzo vs media 200",
      price > v.sma200 ? 1 : -1,
      price > v.sma200
        ? "sopra la media a 200 giorni"
        : "sotto la media a 200 giorni",
    );
  if (v.sma50 != null && v.sma200 != null)
    add(
      "Incrocio medie",
      v.sma50 > v.sma200 ? 1 : -1,
      v.sma50 > v.sma200
        ? "media 50 sopra media 200 (golden cross)"
        : "media 50 sotto media 200 (death cross)",
    );
  if (v.rsi != null)
    add(
      "RSI 14",
      v.rsi >= 70 ? -1 : v.rsi <= 30 ? 1 : 0,
      v.rsi >= 70
        ? "ipercomprato"
        : v.rsi <= 30
          ? "ipervenduto"
          : "zona neutra",
    );
  if (v.macdHist != null)
    add(
      "MACD",
      v.macdHist > 0 ? 1 : -1,
      v.macdHist > 0 ? "istogramma positivo" : "istogramma negativo",
    );
  const total = signals.reduce((s, x) => s + x.score, 0);
  const trend = !signals.length
    ? "n/d"
    : total >= 2
      ? "Rialzista"
      : total <= -2
        ? "Ribassista"
        : "Neutro";

  const series = {
    t: candles.map((c) => c.t),
    close: closes,
    sma20: s20,
    sma50: s50,
    sma200: s200,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    rsi: r,
    macd: m.line,
    macdSignal: m.signal,
    macdHist: m.hist,
  };
  return {
    enough: true,
    values: v,
    signals,
    trend,
    signalScore: total,
    series,
  };
}

module.exports = {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  annualizedVolatility,
  maxDrawdown,
  analyze,
  lastDefined,
};
