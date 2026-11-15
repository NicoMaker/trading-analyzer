// Test end-to-end: l'API di Yahoo e' simulata da un server locale con lo STESSO formato di risposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');

let mock, base, server, db;
const PRICE = { AAPL: 200, 'VOD.L': 7000 /* pence */ };

function chartBody(symbol, range) {
  const cur = symbol === 'VOD.L' ? 'GBp' : symbol.endsWith('=X') ? 'EUR' : 'USD';
  const n = range === '5d' ? 5 : 250, ts = [], close = [];
  const now = Math.floor(Date.now() / 1000);
  const last = symbol.endsWith('=X') ? 0.9 : PRICE[symbol] ?? 100;
  for (let i = 0; i < n; i++) { ts.push(now - (n - 1 - i) * 86400); close.push(i === 3 ? null : last * (0.8 + 0.2 * i / n)); }
  close[n - 1] = last;
  return { chart: { result: [{ meta: { symbol, currency: cur, regularMarketPrice: last, regularMarketTime: now, longName: symbol + ' Inc', fullExchangeName: 'TEST' },
    timestamp: ts, indicators: { quote: [{ open: close, high: close.map((c) => c && c * 1.01), low: close.map((c) => c && c * 0.99), close, volume: close.map(() => 1000) }] } }], error: null } };
}

test.before(async () => {
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (u.pathname.startsWith('/v8/finance/chart/')) {
      const sym = decodeURIComponent(u.pathname.split('/').pop());
      if (sym === 'NOPE') return res.end(JSON.stringify({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }));
      return res.end(JSON.stringify(chartBody(sym, u.searchParams.get('range'))));
    }
    if (u.pathname === '/v1/finance/search') return res.end(JSON.stringify({ quotes: [
      { symbol: 'AAPL', longname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY', sectorDisp: 'Technology' }, { symbol: 'X', quoteType: 'OPTION' }] }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => mock.listen(0, r));
  base = `http://127.0.0.1:${mock.address().port}`;
  process.env.YAHOO_HOSTS = base; process.env.FX_FALLBACK_URL = base + '/none';
  process.env.DB_FILE = path.join(os.tmpdir(), `ta-test-${Date.now()}.db`); process.env.JWT_SECRET = 'test-secret';
  db = require('../db/database'); await db.init();
  const { createServer, seedAdmin } = require('../server'); await seedAdmin();
  server = createServer().listen(0); await new Promise((r) => server.on('listening', r));
});
test.after(() => { server.closeAllConnections(); server.close(); mock.close(); db.db.close(); });

const api = (cookie) => async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => null), cookie: sc ? sc.split(';')[0] : null, cleared: sc && /Expires=Thu, 01 Jan 1970/.test(sc) };
};
const login = async (u, p) => { const r = await api()('POST', '/auth/login', { username: u, password: p }); return { ...r, call: api(r.cookie) }; };

test('login, regole admin, criteri password', async () => {
  assert.equal((await login('Admin', 'sbagliata')).status, 401);
  const a = await login('admin', 'Admin123!'); // nome utente non sensibile alle maiuscole
  assert.equal(a.status, 200); assert.equal(a.body.user.role, 'admin');
  for (const pw of ['Ab1!', 'abcdefgh1!', 'ABCDEFGH1!', 'Abcdefgh!!', 'Abcdefgh12'])
    assert.equal((await a.call('POST', '/users', { username: 'u' + pw.length, name: 'x', role: 'utente', password: pw })).status, 400, pw);
  assert.equal((await a.call('POST', '/users', { username: 'mario', name: 'Mario', role: 'utente', password: 'Mario123!' })).status, 201);
  const me = a.body.user.id;
  assert.equal((await a.call('DELETE', `/users/${me}`)).status, 400);
  assert.equal((await a.call('PUT', `/users/${me}`, { role: 'utente' })).status, 400);   // unico admin: non si declassa
  assert.equal((await a.call('PUT', `/users/${me}`, { active: false })).status, 400);
  // altri admin: si puo' eliminare (o disattivare) un admin finche' ne resta almeno un altro attivo
  assert.equal((await a.call('POST', '/users', { username: 'admin2', name: 'A2', role: 'admin', password: 'Admin2222!' })).status, 201);
  assert.equal((await a.call('POST', '/users', { username: 'admin9', name: 'A9', role: 'admin', password: 'Admin9999!' })).status, 201);
  const b = await login('admin2', 'Admin2222!');
  const a9 = (await a.call('GET', '/users')).body.find((u) => u.username === 'admin9');
  assert.equal((await b.call('DELETE', `/users/${a9.id}`)).status, 200);
  assert.equal((await b.call('PUT', `/users/${me}`, { active: false })).status, 200);   // anche l'admin iniziale non e' piu' intoccabile
  assert.equal((await b.call('PUT', `/users/${me}`, { active: true })).status, 200);
  // l'ultimo admin attivo non si elimina nemmeno da se stesso
  assert.equal((await b.call('PUT', `/users/${me}`, { active: false })).status, 200);
  assert.equal((await b.call('DELETE', `/users/${b.body.user.id}`)).status, 400);
  assert.equal((await b.call('PUT', `/users/${me}`, { active: true })).status, 200);
  // con un altro admin attivo, un admin puo' eliminare il proprio account (anche l'iniziale)
  const sacr = await a.call('POST', '/users', { username: 'admin7', name: 'A7', role: 'admin', password: 'Admin7777!' });
  const c7 = await login('admin7', 'Admin7777!');
  const del7 = await c7.call('DELETE', `/users/${sacr.body.id}`);
  assert.equal(del7.status, 200); assert.equal(del7.body.relogin, true);
});

test('cambio credenziali: esce chi lo fa e ogni altra sessione', async () => {
  const a = await login('admin2', 'Admin2222!'), a2 = await login('admin2', 'Admin2222!');
  assert.equal((await a2.call('GET', '/auth/me')).status, 200);
  assert.equal((await a.call('POST', '/auth/change-password', { current: 'Admin2222!', next: 'debole' })).status, 400);
  assert.equal((await a.call('POST', '/auth/change-password', { current: 'sbagliata', next: 'Nuova1234!' })).status, 401);
  const r = await a.call('POST', '/auth/change-password', { current: 'Admin2222!', next: 'Nuova1234!' });
  assert.equal(r.status, 200); assert.ok(r.cleared);
  assert.equal((await a.call('GET', '/auth/me')).status, 401);
  assert.equal((await a2.call('GET', '/auth/me')).status, 401); // altra sessione dello stesso utente
  const c = await login('admin2', 'Nuova1234!'); assert.equal(c.status, 200);
  const u = await c.call('POST', '/auth/change-username', { current: 'Nuova1234!', username: 'admin3' });
  assert.equal(u.status, 200); assert.ok(u.cleared);
  assert.equal((await c.call('GET', '/auth/me')).status, 401);
  assert.equal((await login('admin2', 'Nuova1234!')).status, 401);
  assert.equal((await login('admin3', 'Nuova1234!')).status, 200);
  // admin che modifica il PROPRIO account da gestione utenti: esce anche lui
  const d = await login('admin3', 'Nuova1234!');
  const self = await d.call('PUT', `/users/${d.body.user.id}`, { username: 'admin4' });
  assert.equal(self.status, 200); assert.equal(self.body.relogin, true);
  assert.equal((await d.call('GET', '/auth/me')).status, 401);
});

test('portafoglio con dati di mercato, alert, clienti e permessi', async () => {
  const m = await login('mario', 'Mario123!'); const call = m.call;
  assert.equal((await call('GET', '/users')).status, 403);
  // ricerca e ISIN
  const s = await call('GET', '/market/search?q=apple'); assert.equal(s.body[0].symbol, 'AAPL'); assert.equal(s.body[0].sector, 'Technology'); assert.equal(s.body[0].price, 200);
  // ricerca vuota: TUTTI i titoli (portafoglio + elenco aziende) con prezzo reale
  const all0 = await call('GET', '/market/search'); assert.equal(all0.status, 200); assert.ok(all0.body.length >= 40); assert.ok(all0.body.some((x) => x.symbol === 'ENI.MI' && x.price > 0));
  // titolo in USD: valuta e ticker ricavati dall'API
  assert.equal((await call('POST', '/positions', { isin: 'US0378331005', name: 'Apple', ticker: 'AAPL', stopPrice: 210, targetPrice: 400, maxWeight: 80 })).status, 201);
  assert.equal((await call('POST', '/positions', { isin: 'GB00BH4HKS39', name: 'Vodafone', ticker: 'VOD.L' })).status, 201);
  assert.equal((await call('POST', '/positions', { isin: 'US0378331005', name: 'dup' })).status, 409);
  assert.equal((await call('POST', '/positions', { isin: 'ZZ', name: 'x', stopPrice: 10, targetPrice: 5 })).status, 400);
  assert.equal((await call('POST', '/operations', { date: '2025-01-02', isin: 'US0378331005', type: 'Acquisto', quantity: 10, price: 150, fx: 0.95, fees: 1 })).status, 201);
  assert.equal((await call('POST', '/operations', { date: '2025-02-02', isin: 'US0378331005', type: 'Vendita', quantity: 11, price: 160, fx: 0.95 })).status, 400);
  assert.equal((await call('POST', '/operations', { date: '2025-02-02', isin: 'NONESISTE', type: 'Acquisto', quantity: 1, price: 1 })).status, 400);
  assert.equal((await call('POST', '/operations', { date: '2025-01-03', isin: 'GB00BH4HKS39', type: 'Acquisto', quantity: 100, price: 1.2, fx: 1.15 })).status, 201);

  const pf = (await call('GET', '/positions')).body;
  const aapl = pf.positions.find((p) => p.ticker === 'AAPL'), vod = pf.positions.find((p) => p.ticker === 'VOD.L');
  assert.equal(aapl.currency, 'USD'); assert.equal(aapl.price, 200); assert.equal(aapl.fx, 0.9);
  assert.ok(Math.abs(aapl.value - 10 * 200 * 0.9) < 1e-9);          // 1800
  assert.ok(Math.abs(aapl.cost - (10 * 150 * 0.95 + 1)) < 1e-9);    // 1426
  assert.ok(aapl.alerts.some((a) => a.code === 'target') === false);
  assert.ok(aapl.alerts.some((a) => a.code === 'stop'));            // 200 <= 210
  assert.equal(vod.currency, 'GBP'); assert.equal(vod.price, 70);   // 7000 pence -> 70 GBP
  assert.ok(Math.abs(pf.totals.value - (1800 + 100 * 70 * 0.9)) < 1e-6);
  assert.ok(Math.abs(aapl.weight + vod.weight - 100) < 1e-9);
  assert.ok(aapl.rsi != null && aapl.trend);

  const an = (await call('GET', `/positions/${aapl.id}/analysis`)).body;
  assert.ok(an.analysis.enough && an.candles.length === 249 /* un giorno null scartato */ && an.analysis.values.sma200 != null);

  // prezzo storico a una data (dal mock: serie crescente fino a oggi)
  const d10 = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const pa = await call('GET', `/market/price-at?symbol=AAPL&date=${d10}`);
  assert.equal(pa.status, 200); assert.ok(pa.body.price > 0 && pa.body.price <= 200 && pa.body.priceDate <= d10); assert.equal(pa.body.fx, null); // riserva cambio non raggiungibile nel test
  assert.equal((await call('GET', '/market/price-at?symbol=AAPL&date=2001-01-01')).status, 502);

  // clienti e allocazioni
  const cl = (await call('POST', '/clients', { name: 'Rossi Anna', capital: 5000 })).body.id;
  const al = await call('POST', `/clients/${cl}/allocations`, { isin: 'US0378331005', euro: 900 });
  assert.equal(al.status, 201); assert.ok(Math.abs(al.body.entryPriceEur - 180) < 1e-9);
  assert.equal((await call('POST', `/clients/${cl}/allocations`, { isin: 'US0378331005', euro: -5 })).status, 400);
  const det = (await call('GET', `/clients/${cl}`)).body;
  assert.equal(det.holdings[0].units, 5); assert.ok(Math.abs(det.totals.value - 900) < 1e-9);
  await call('POST', `/clients/${cl}/allocations`, { isin: 'US0378331005', euro: 2000 });
  assert.ok((await call('GET', '/alerts')).body.active.some((a) => a.code === 'over_allocated'));

  // utente collegato al cliente: vede solo il suo
  const adm = await login('Admin', 'Admin123!');
  assert.equal((await adm.call('POST', '/users', { username: 'anna', name: 'Anna', role: 'cliente', password: 'Anna12345!' })).status, 400); // manca cliente
  // l'admin puo' agire sul portafoglio di mario con ?owner=
  const owners = (await adm.call('GET', '/users/owners')).body; const marioId = owners.find((o) => o.username === 'mario').id;
  assert.equal((await adm.call('GET', '/positions')).body.positions.length, 0);
  assert.equal((await adm.call('GET', `/positions?owner=${marioId}`)).body.positions.length, 2);
  // un utente normale non puo' usare ?owner= su altri
  assert.equal((await call('GET', `/positions?owner=${owners[0].id}`)).body.positions.length, 2);
  assert.equal((await adm.call('POST', '/users', { username: 'anna', name: 'Anna', role: 'cliente', clientId: cl, password: 'Anna12345!' })).status, 201);
  const an2 = await login('anna', 'Anna12345!');
  const mine = await an2.call('GET', '/me/portfolio');
  assert.equal(mine.status, 200); assert.equal(mine.body.holdings.length, 2);
  assert.equal((await an2.call('GET', '/positions')).status, 403);
  assert.equal((await an2.call('GET', '/clients')).status, 403);

  // ticker inesistente -> alert quotazione mancante, con prezzo manuale come riserva
  await call('POST', '/positions', { isin: 'XX0000000001', name: 'Fantasma', ticker: 'NOPE', currency: 'EUR' });
  await call('POST', '/operations', { date: '2025-01-03', isin: 'XX0000000001', type: 'Acquisto', quantity: 1, price: 10 });
  let g = (await call('GET', '/positions')).body.positions.find((p) => p.ticker === 'NOPE');
  assert.ok(g.alerts.some((a) => a.code === 'quote_missing'));
  await call('PUT', `/positions/${g.id}`, { name: 'Fantasma', ticker: 'NOPE', currency: 'EUR', manualPrice: 12 });
  g = (await call('GET', '/positions')).body.positions.find((p) => p.ticker === 'NOPE');
  assert.equal(g.value, 12); assert.equal(g.priceSource, 'manuale');

  // eliminare un acquisto che renderebbe una vendita oltre saldo e' bloccato; eliminare la posizione ripulisce tutto
  const ops = (await call('GET', '/operations')).body;
  assert.equal(ops.length, 3);
  assert.equal((await call('DELETE', `/positions/${g.id}`)).status, 200);
  assert.equal((await call('GET', '/operations')).body.length, 2);
});

const { io: ioClient } = require('socket.io-client');
const waitEvent = (sock, evt, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + evt)), ms); sock.once(evt, (d) => { clearTimeout(t); res(d); }); });
const connect = async (cookie) => { const s = ioClient(`http://127.0.0.1:${server.address().port}`, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false }); await waitEvent(s, 'connect'); return s; };

test('capitale cliente, acquisto a mercato, stop loss e perdita massima (vendita forzata), notifiche', async () => {
  const trading = require('../services/trading'), market = require('../services/market');
  PRICE.MSFT = 100;
  const adm = await login('Admin', 'Admin123!');
  assert.equal((await adm.call('POST', '/users', { username: 'luca', name: 'Luca', role: 'utente', password: 'Luca12345!' })).status, 201);
  const luca = await login('luca', 'Luca12345!'); const call = luca.call; const lucaId = luca.body.user.id;

  const noCap = (await call('POST', '/clients', { name: 'Senza capitale' })).body.id;
  assert.equal((await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 100, clientId: noCap })).status, 400);       // capitale non impostato
  const cl = (await call('POST', '/clients', { name: 'Verdi', capital: 1000, defaultStopPct: 10, maxDrawdownPct: 30 })).body.id;
  assert.equal((await call('POST', '/clients', { name: 'x', defaultStopPct: 150 })).status, 400);
  const b1 = await call('POST', '/trade/buy', { symbol: 'msft', euro: 400, clientId: cl });
  assert.equal(b1.status, 201); assert.ok(Math.abs(b1.body.priceEur - 90) < 1e-9); assert.ok(Math.abs(b1.body.quantity - 400 / 90) < 1e-9); assert.equal(b1.body.stopLossPct, 10);
  const over = await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 700, clientId: cl });
  assert.equal(over.status, 400); assert.match(over.body.error, /Capitale insufficiente/);
  assert.equal((await call('POST', `/clients/${cl}/allocations`, { isin: 'MSFT', euro: 700 })).status, 400);          // vale anche per l'assegnazione manuale
  let det = (await call('GET', `/clients/${cl}`)).body;
  assert.equal(det.totals.capital, 1000); assert.ok(Math.abs(det.totals.cash - 600) < 1e-9); assert.ok(Math.abs(det.totals.invested - 400) < 1e-9);
  // l'acquisto ha registrato anche l'operazione nel portafoglio (quote reali al prezzo di mercato)
  const pos = (await call('GET', '/positions')).body.positions.find((p) => p.ticker === 'MSFT');
  assert.ok(Math.abs(pos.quantity - 400 / 90) < 1e-9 && Math.abs(pos.cost - 400) < 1e-6);

  // il cliente collegato riceve la notifica d'acquisto e vede capitale e liquidita'
  assert.equal((await adm.call('POST', '/users', { username: 'verdi', name: 'Verdi', role: 'cliente', clientId: cl, password: 'Verdi12345!' })).status, 201);
  const verdi = await login('verdi', 'Verdi12345!');
  const sock = await connect(verdi.cookie);
  const mine = (await verdi.call('GET', '/me/portfolio')).body; assert.ok(Math.abs(mine.totals.cash - 600) < 1e-9);

  // prezzo -20%: stop loss al -10% => vendita forzata automatica
  const live = waitEvent(sock, 'notification');
  PRICE.MSFT = 80; await market.getSymbolData('MSFT', { force: true });
  const closed = await trading.runRisk(lucaId);
  assert.equal(closed.length, 1); assert.equal(closed[0].reason, 'stop_loss');
  const note = await live; assert.equal(note.kind, 'forced_sale');                                                     // notifica in diretta al cliente
  det = (await call('GET', `/clients/${cl}`)).body;
  assert.equal(det.holdings[0].status, 'closed'); assert.equal(det.holdings[0].exitReason, 'stop_loss');
  assert.ok(Math.abs(det.totals.cash - 920) < 1e-6); assert.ok(Math.abs(det.totals.realized + 80) < 1e-6); assert.equal(det.totals.invested, 0);
  assert.equal((await call('GET', '/positions')).body.positions.find((p) => p.ticker === 'MSFT').quantity, 0);          // anche le quote sono state vendute
  assert.equal((await call('POST', `/trade/close/${det.holdings[0].id}`)).status, 404);                                // gia' chiusa
  const notes = (await verdi.call('GET', '/notifications')).body; assert.ok(notes.items.some((n) => n.kind === 'forced_sale') && notes.unread >= 1);  // (l'utente e' stato creato dopo l'acquisto: la notifica d'acquisto e' coperta sotto)
  const buyLive = waitEvent(await connect(verdi.cookie), 'notification');
  assert.equal((await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 10, clientId: cl })).status, 201);
  assert.equal((await buyLive).kind, 'buy');                                                                          // il cliente e' avvisato in diretta quando gli si compra un titolo
  sock.close();

  // perdita massima sul capitale: -30% => si vende tutto
  const cl2 = (await call('POST', '/clients', { name: 'Neri', capital: 1000, maxDrawdownPct: 20 })).body.id;
  assert.equal((await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 1000, clientId: cl2 })).status, 201);
  PRICE.MSFT = 60; await market.getSymbolData('MSFT', { force: true });
  const c2 = await trading.runRisk(lucaId); assert.equal(c2.filter((x) => x.reason === 'drawdown').length, 1); // (la piccola allocazione di Verdi esce per stop loss)

  // vendita manuale di un'allocazione e di quote libere
  PRICE.MSFT = 100;
  const cl3 = (await call('POST', '/clients', { name: 'Gialli', capital: 500 })).body.id;
  assert.equal((await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 450, clientId: cl3 })).status, 201);
  assert.equal((await call('POST', '/trade/buy', { symbol: 'MSFT', euro: 90 })).status, 201);                          // acquisto senza cliente
  const free = (await call('GET', '/positions')).body.positions.find((p) => p.ticker === 'MSFT');
  assert.equal((await call('POST', '/trade/sell', { positionId: free.id, quantity: 99 })).status, 400);                // oltre le quote libere
  assert.equal((await call('POST', '/trade/sell', { positionId: free.id, all: true })).status, 200);
  const alloc = (await call('GET', `/clients/${cl3}`)).body.holdings[0];
  const sold = await call('POST', `/trade/close/${alloc.id}`); assert.equal(sold.status, 200); assert.equal(sold.body.reason, 'manuale');
  assert.ok(Math.abs((await call('GET', `/clients/${cl3}`)).body.totals.cash - 500) < 1e-6);

  // grafici delle rendite (serie storica reale dal mock)
  const mar = await login('mario', 'Mario123!');
  const perf = (await mar.call('GET', '/positions/performance?days=365')).body; assert.ok(perf.times.length > 10 && perf.value.length === perf.times.length && perf.cost.every((c) => c > 0));
  const cperf = (await call('GET', `/clients/${cl3}/performance`)).body; assert.ok(cperf.times.length >= 1);
  // l'admin vede la piattaforma del cliente e opera sul portafoglio di luca
  assert.equal((await adm.call('GET', '/me/portfolio')).status, 400);
  assert.equal((await adm.call('GET', `/me/portfolio?as=${verdi.body.user.id}`)).status, 200);
  assert.equal((await adm.call('POST', `/trade/buy?owner=${lucaId}`, { symbol: 'MSFT', euro: 50 })).status, 201);
  assert.equal((await verdi.call('GET', '/trade/buy')).status, 403);
});

test('socket.io: modifiche in diretta e uscita immediata al cambio credenziali', async () => {
  const adm = await login('Admin', 'Admin123!');
  assert.equal((await adm.call('POST', '/users', { username: 'kick1', name: 'K', role: 'utente', password: 'Kick12345!' })).status, 201);
  const k = await login('kick1', 'Kick12345!');
  const s = await connect(k.cookie);
  const changed = waitEvent(s, 'data:changed');
  await k.call('POST', '/clients', { name: 'Live' });
  assert.equal((await changed).by, k.body.user.id);                       // l'altro dispositivo aggiorna i dati senza ricaricare

  const kicked = waitEvent(s, 'session:kicked');
  const id = k.body.user.id;
  assert.equal((await adm.call('PUT', `/users/${id}`, { password: 'Kick54321!' })).status, 200);
  assert.match(await kicked, /credenziali/i);                              // l'utente collegato esce subito, senza fare richieste
  assert.equal((await k.call('GET', '/auth/me')).status, 401);
  s.close();
  // anche disattivazione ed eliminazione fanno uscire subito
  const k2 = await login('kick1', 'Kick54321!'); const s2 = await connect(k2.cookie);
  const k3 = waitEvent(s2, 'session:kicked');
  assert.equal((await adm.call('DELETE', `/users/${id}`)).status, 200); await k3; s2.close();
  // senza cookie la connessione e' rifiutata
  const bad = ioClient(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'], reconnection: false });
  await waitEvent(bad, 'connect_error'); bad.close();
});
