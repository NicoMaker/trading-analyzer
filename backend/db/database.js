const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('../config');

fs.mkdirSync(path.dirname(config.DB_FILE), { recursive: true });
const db = new sqlite3.Database(config.DB_FILE);

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    }));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r))));

// Esegue piu' scritture in modo atomico. Le richieste sono serializzate dentro la stessa connessione.
let txQueue = Promise.resolve();
function transaction(fn) {
  const job = txQueue.then(async () => {
    await run('BEGIN');
    try {
      const out = await fn({ run, get, all });
      await run('COMMIT');
      return out;
    } catch (e) {
      await run('ROLLBACK').catch(() => {});
      throw e;
    }
  });
  txQueue = job.catch(() => {});
  return job;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  capital REAL NOT NULL DEFAULT 0,       -- capitale del cliente in EUR: limite di quanto si puo' investire
  default_stop_pct REAL,                 -- stop loss % applicato alle nuove allocazioni (vendita forzata)
  max_drawdown_pct REAL,                 -- perdita % massima sul capitale: oltre si vende tutto in automatico
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','utente','cliente')),
  client_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,        -- admin creato al primo avvio (solo informativo: si puo' eliminare se resta almeno un altro admin attivo)
  token_version INTEGER NOT NULL DEFAULT 0,    -- cambia con nome utente/password: invalida tutte le sessioni aperte
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  isin TEXT NOT NULL,
  name TEXT NOT NULL,
  ticker TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  sector TEXT,
  risk TEXT DEFAULT 'Da valutare',
  max_weight REAL,          -- % peso massimo
  stop_price REAL,          -- avviso se prezzo <= stop (in valuta del titolo)
  target_price REAL,        -- avviso se prezzo >= obiettivo
  min_value_eur REAL,       -- avviso se valore posizione < X EUR
  min_pl_pct REAL,          -- avviso se utile/perdita % < X (es. -10)
  day_drop_pct REAL,        -- avviso se variazione giornaliera <= -X %
  rsi_low REAL,             -- soglia ipervenduto (default 30)
  rsi_high REAL,            -- soglia ipercomprato (default 70)
  next_review TEXT,
  dividends REAL NOT NULL DEFAULT 0,
  manual_price REAL,        -- usato solo se l'API non risponde
  manual_fx REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, isin),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  isin TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Acquisto','Vendita')),
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  fx REAL NOT NULL DEFAULT 1,
  fees REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ops_owner ON operations(owner_id, date, id);
CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  isin TEXT NOT NULL,
  euro REAL NOT NULL CHECK (euro > 0),
  entry_price_eur REAL,      -- prezzo in EUR per azione al momento dell'assegnazione
  note TEXT,
  stop_loss_pct REAL,        -- se la perdita raggiunge questa % l'allocazione viene venduta in automatico
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed
  closed_at TEXT,
  exit_price_eur REAL,
  exit_reason TEXT,          -- manuale | stop_loss | drawdown
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id);
CREATE TABLE IF NOT EXISTS market_cache (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  exchange TEXT,
  currency TEXT,
  price REAL,
  market_time INTEGER,
  candles TEXT,
  fetched_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS fx_cache (
  currency TEXT PRIMARY KEY,
  eur_per_unit REAL NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  isin TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, isin, code, day)
);
`;

// Aggiunge una colonna ai database creati con versioni precedenti. Restituisce true se l'ha aggiunta ora.
async function ensureColumn(table, column, ddl) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return false;
  await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

async function migrate() {
  const capitalAdded = await ensureColumn('clients', 'capital', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('clients', 'default_stop_pct', 'REAL');
  await ensureColumn('clients', 'max_drawdown_pct', 'REAL');
  await ensureColumn('allocations', 'stop_loss_pct', 'REAL');
  await ensureColumn('allocations', 'status', "TEXT NOT NULL DEFAULT 'open'");
  await ensureColumn('allocations', 'closed_at', 'TEXT');
  await ensureColumn('allocations', 'exit_price_eur', 'REAL');
  await ensureColumn('allocations', 'exit_reason', 'TEXT');
  // Dati esistenti: il capitale parte dal totale gia' assegnato, cosi' nulla risulta fuori limite
  if (capitalAdded) await run('UPDATE clients SET capital = COALESCE((SELECT SUM(euro) FROM allocations WHERE client_id = clients.id), 0)');
}

async function init() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');
  for (const stmt of SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await run(stmt);
  }
  await migrate();
}

module.exports = { db, run, get, all, transaction, init };
