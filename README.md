# Trading Analyzer

Analisi del portafoglio azionario in tempo reale (socket.io) con quotazioni reali, alert su soglie personali, utenti con ruoli e allocazione di importi in euro ai clienti.
Logica ricavata dal file `Controllo_azioni.xlsx` (prezzo medio mobile, stop, obiettivo, peso massimo, revisione, quotazioni mancanti, controlli sulle operazioni), qui con dati scaricati in automatico.

> Guida di utilizzo completa: **GUIDA.md** (e pagina **Guida** nel menu dell'app).

## Avvio
Richiede Node.js 18 o superiore.

    npm install
    npm start          (oppure doppio clic su avvia.bat / ./avvia.sh)

Il server parte su http://localhost:3000, serve `frontend/index.html` (il browser non si apre da solo: vai tu all'indirizzo; `PORT=3001` per cambiare porta).

**Primo accesso:** utente `Admin`, password `Admin123!` (cambiala da "Il mio account").

## Struttura
    backend/
      server.js            avvio Express, creazione admin, serve il frontend
      config.js            porte, API, tempi
      db/database.js       SQLite3: schema e funzioni
      middleware/auth.js   sessioni (cookie httpOnly + JWT), ruoli
      routes/              auth, users, positions, operations, clients, market, alerts, me
      services/            market (Yahoo Finance), indicators (RSI, MACD, medie...), portfolio, alerts, scheduler
      tests/               test automatici (npm test)
      data/                database SQLite (creato al primo avvio)
    frontend/
      index.html
      css/                 base.css, components.css
      js/                  app.js (router), api.js, store.js, utils.js
      js/components/       login, navbar, dashboard, positions, stock-detail, operations, alerts, clients, users, chart, ui

## Ruoli
- **admin**: tutto; crea/modifica/elimina utenti; con il selettore "Portafoglio di" vede e gestisce i dati di ogni utente.
- **utente**: gestisce solo il proprio portafoglio, i propri clienti e le allocazioni.
- **cliente**: sola lettura delle proprie allocazioni (collegato a un cliente).

Regole: password di almeno 8 caratteri con maiuscola, minuscola, numero e simbolo. Qualsiasi admin (anche quello iniziale) può essere eliminato o disattivato da un altro admin, finché resta almeno un admin attivo; nessuno può eliminare sé stesso. Cambiando nome utente, password, ruolo o stato di un account, quell'utente esce **subito** da tutti i dispositivi (socket.io).

## Dati di mercato
Yahoo Finance (gratuito, senza chiave): quotazioni, storico a 1 anno, ricerca per nome/ticker/ISIN. Cambi da Yahoo con riserva Frankfurter (BCE). I dati sono in cache SQLite (10 minuti) e aggiornati in background; se l'API non risponde si usa l'ultimo dato salvato o il prezzo manuale. Yahoo è un servizio non ufficiale: può cambiare o limitare le richieste.
Il ticker usa il formato Yahoo (AAPL, ENI.MI, VOD.L, SAP.DE...). Dalla ricerca "Cerca titolo" si compila da solo.

## Alert
Soglie impostabili per ogni titolo: stop (prezzo scende a), obiettivo, valore posizione sotto X €, utile/perdita sotto X %, calo giornaliero, peso massimo, RSI, prossima revisione. In più: quotazione mancante/datata, allocazioni oltre il costo, sotto media 200, death cross, MACD negativo. Si vedono tutti insieme (il foglio ne mostrava uno alla volta), con avvisi a schermo e storico.

Gli indicatori non sono consigli di investimento.

## Novità: tempo reale, capitale clienti, acquisti, vendita forzata
- **Socket.io**: quotazioni aggiornate ogni 60 s dal server e inviate a tutti i client collegati; ogni modifica (operazioni, clienti, acquisti) si vede subito anche sugli altri dispositivi. Pallino "live" nel menu.
- **Pagina Titoli**: sotto le tue posizioni elenca sempre anche tutti gli altri titoli disponibili (non comprati) con il prezzo reale e la variazione del giorno; da lì si può "Compra" o "Aggiungi" al portafoglio. Il filtro cerca su entrambi gli elenchi.
- **Ricerca titoli**: aperta senza scrivere mostra TUTTI i titoli (tuoi + ~45 aziende reali di USA, Italia, Europa, ETF) con prezzo; scrivendo filtra e cerca su tutto Yahoo (nome, ticker, ISIN).
- **Capitale cliente**: in Clienti > Modifica imposti capitale, stop loss standard e perdita massima. Non si può investire oltre la liquidità.
- **Compra / Vendi**: "＋ Compra" sceglie titolo, cliente e importo, acquista al prezzo reale (quote frazionarie), registra l'operazione e assegna l'importo; il cliente riceve una notifica in diretta. Vendi quote libere o l'allocazione di un cliente (l'incasso torna in liquidità).
- **Vendita forzata**: se un'allocazione perde la % di stop loss, o il patrimonio del cliente scende oltre la perdita massima, viene venduto tutto in automatico (solo con prezzo reale aggiornato) e si avvisano cliente e gestore.
- **Admin**: "Apri piattaforma" in Utenti entra nel portafoglio di un utente (compri/vendi per lui) o nella vista di un cliente; banner per tornare indietro.
- **Grafici** delle rendite (valore vs costo e rendimento %) su dashboard, cliente e area cliente. **Notifiche** con campanella.
- I form lunghi scorrono dentro la finestra (barra Salva sempre visibile, anche su mobile).

I database creati con la versione precedente si aggiornano da soli all'avvio.
