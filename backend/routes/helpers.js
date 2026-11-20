// Piccole utilita' condivise dalle route.
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

// Numero opzionale: '' / null / undefined -> null. Se presente deve essere finito e rispettare i limiti.
function optNum(v, label, { min, max, gt } = {}) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${label}: numero non valido`);
  if (min != null && n < min) throw bad(`${label}: minimo ${min}`);
  if (max != null && n > max) throw bad(`${label}: massimo ${max}`);
  if (gt != null && n <= gt)
    throw bad(`${label}: deve essere maggiore di ${gt}`);
  return n;
}
function reqNum(v, label, opts) {
  const n = optNum(v, label, opts);
  if (n == null) throw bad(`${label}: obbligatorio`);
  return n;
}
const str = (v, max = 200) =>
  v == null ? null : String(v).trim().slice(0, max) || null;
function reqStr(v, label, max = 200) {
  const s = str(v, max);
  if (!s) throw bad(`${label}: obbligatorio`);
  return s;
}

// Criteri minimi password: 8+ caratteri, maiuscola, minuscola, numero e simbolo.
function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8)
    throw bad("La password deve avere almeno 8 caratteri");
  if (pw.length > 100)
    throw bad("La password e' troppo lunga (max 100 caratteri)");
  if (!/[a-z]/.test(pw))
    throw bad("La password deve contenere una lettera minuscola");
  if (!/[A-Z]/.test(pw))
    throw bad("La password deve contenere una lettera maiuscola");
  if (!/[0-9]/.test(pw)) throw bad("La password deve contenere un numero");
  if (!/[^A-Za-z0-9]/.test(pw))
    throw bad("La password deve contenere un simbolo (es. ! ? # @ $)");
  return pw;
}
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
function checkUsername(u) {
  const s = reqStr(u, "Utente", 32);
  if (!USERNAME_RE.test(s))
    throw bad("Utente: 3-32 caratteri tra lettere, numeri, . _ -");
  return s;
}

const RISKS = ["Basso", "Medio", "Alto", "Molto alto", "Da valutare"];
const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "DKK",
  "NOK",
  "SEK",
  "JPY",
  "CAD",
  "AUD",
  "Altro",
];

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: err.message });
  if (err && err.code === "SQLITE_CONSTRAINT") {
    const m = String(err.message);
    if (m.includes("UNIQUE"))
      return res
        .status(409)
        .json({ error: "Esiste gia un elemento con questi dati" });
    return res.status(400).json({ error: "Dati non validi" });
  }
  if (err && err.type === "entity.parse.failed")
    return res.status(400).json({ error: "JSON non valido" });
  console.error(err);
  res.status(500).json({ error: "Errore interno del server" });
}

module.exports = {
  wrap,
  HttpError,
  bad,
  optNum,
  reqNum,
  str,
  reqStr,
  checkPassword,
  checkUsername,
  RISKS,
  CURRENCIES,
  errorHandler,
};
