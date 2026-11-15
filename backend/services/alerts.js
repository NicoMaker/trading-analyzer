// Alert di una posizione. Include tutti i controlli del foglio "Controllo azioni"
// (stop, obiettivo, revisione, peso massimo, quotazioni mancanti, posizione chiusa)
// piu' le soglie che l'utente puo' scrivere per titolo e i segnali tecnici.
// A differenza del foglio (una priorita' alla volta) qui vengono elencati TUTTI gli alert attivi.
const config = require('../config');

const fmt = (n, d = 2) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });

function evaluateAlerts(p, { today, analysis }) {
  const out = [];
  const add = (code, severity, title, message) => out.push({ code, severity, title, message });

  if (!p.hasOperations) {
    add('no_operations', 'info', 'Nessuna operazione', 'Registra un acquisto per iniziare a monitorare la posizione.');
  } else if (p.quantity === 0) {
    add('closed', 'info', 'Posizione chiusa/vuota', 'Quantita pari a zero: nessun controllo attivo.');
  }
  const active = p.quantity > 0;

  // Revisione programmata: vale anche senza quotazioni
  if (active && p.nextReview && p.nextReview <= today) {
    add('review', 'warning', 'Revisione da fare', `Revisione prevista il ${p.nextReview}.`);
  }
  if (!active) return out;

  if (p.price == null || p.fx == null) {
    add('quote_missing', 'danger', 'Prezzo/cambio mancanti',
      p.quoteError ? `Quotazione non disponibile: ${p.quoteError}. Inserisci un prezzo manuale oppure correggi il ticker.` : 'Quotazione non disponibile.');
    return out;
  }
  if (p.priceSource === 'manuale') add('manual_price', 'info', 'Prezzo manuale', 'Si sta usando il prezzo inserito a mano: l\'API non ha fornito dati.');
  if (p.priceSource === 'cache') add('quote_stale', 'warning', 'Quotazione non aggiornata', 'L\'API non risponde: mostrato l\'ultimo prezzo salvato.');
  if (p.priceSource === 'api' && p.quoteTime && (Date.now() - p.quoteTime) / 86400000 > config.STALE_DAYS) {
    add('quote_old', 'warning', 'Data prezzo datata', `Ultima quotazione del ${new Date(p.quoteTime).toISOString().slice(0, 10)}: il titolo potrebbe essere sospeso o non quotato.`);
  }

  const cur = p.currency;
  // Stop e obiettivo (soglie in valuta del titolo, come nel foglio)
  if (p.stopPrice != null) {
    if (p.price <= p.stopPrice) add('stop', 'danger', 'Stop raggiunto', `Prezzo ${fmt(p.price)} ${cur} <= stop ${fmt(p.stopPrice)} ${cur}.`);
    else if (p.price <= p.stopPrice * 1.03) add('near_stop', 'warning', 'Vicino allo stop', `Prezzo ${fmt(p.price)} ${cur}, a meno del 3% dallo stop (${fmt(p.stopPrice)} ${cur}).`);
  }
  if (p.targetPrice != null && p.price >= p.targetPrice) {
    add('target', 'success', 'Obiettivo raggiunto', `Prezzo ${fmt(p.price)} ${cur} >= obiettivo ${fmt(p.targetPrice)} ${cur}.`);
  }
  // Soglie "se il valore e' inferiore a quello che scrivi tu"
  if (p.minValueEur != null && p.value != null && p.value < p.minValueEur) {
    add('min_value', 'danger', 'Valore sotto soglia', `Valore posizione ${fmt(p.value)} EUR < soglia ${fmt(p.minValueEur)} EUR.`);
  }
  if (p.minPlPct != null && p.pnlPct != null && p.pnlPct < p.minPlPct) {
    add('min_pl', 'danger', 'Perdita oltre soglia', `Utile/perdita ${fmt(p.pnlPct)}% < soglia ${fmt(p.minPlPct)}%.`);
  }
  if (p.dayDropPct != null && p.dayChangePct != null && p.dayChangePct <= -Math.abs(p.dayDropPct)) {
    add('day_drop', 'warning', 'Calo giornaliero', `Oggi ${fmt(p.dayChangePct)}% (soglia -${fmt(Math.abs(p.dayDropPct))}%).`);
  }
  if (p.maxWeight != null && p.weight != null && p.weight > p.maxWeight) {
    add('overweight', 'warning', 'Oltre peso massimo', `Peso ${fmt(p.weight)}% > massimo ${fmt(p.maxWeight)}%.`);
  }
  if (p.allocatedEur > p.cost + 0.01) {
    add('over_allocated', 'warning', 'Allocazioni oltre il costo', `Assegnati ai clienti ${fmt(p.allocatedEur)} EUR, ma il costo della posizione e' ${fmt(p.cost)} EUR.`);
  }

  // Segnali tecnici
  if (analysis && analysis.enough) {
    const v = analysis.values;
    const lo = p.rsiLow != null ? p.rsiLow : 30, hi = p.rsiHigh != null ? p.rsiHigh : 70;
    if (v.rsi != null && v.rsi <= lo) add('rsi_low', 'info', 'RSI ipervenduto', `RSI ${fmt(v.rsi, 1)} <= ${lo}.`);
    if (v.rsi != null && v.rsi >= hi) add('rsi_high', 'warning', 'RSI ipercomprato', `RSI ${fmt(v.rsi, 1)} >= ${hi}.`);
    if (v.sma200 != null && v.price < v.sma200) add('below_sma200', 'warning', 'Sotto media 200', `Prezzo ${fmt(v.price)} < media 200 giorni ${fmt(v.sma200)}.`);
    if (v.sma50 != null && v.sma200 != null && v.sma50 < v.sma200) add('death_cross', 'info', 'Death cross', 'Media 50 sotto media 200.');
    if (v.macdHist != null && v.macdHist < 0 && v.macd < 0) add('macd_neg', 'info', 'MACD negativo', 'MACD sotto zero e sotto la linea di segnale.');
  }

  const order = { danger: 0, warning: 1, success: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

module.exports = { evaluateAlerts };
