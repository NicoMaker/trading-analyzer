# Trading Analyzer — Guida di utilizzo

Guida rapida per ogni ruolo: **Amministratore**, **Utente** e **Cliente**. La stessa guida è nell'app, alla voce **Guida** del menu.

## Indice

1. [Primi passi](#primi-passi)
2. [Dashboard](#dashboard)
3. [Titoli](#titoli)
4. [Scheda del titolo](#scheda-titolo)
5. [Operazioni](#operazioni)
6. [Alert](#alert)
7. [Clienti](#clienti)
8. [Il mio portafoglio (ruolo Cliente)](#area-cliente)
9. [Utenti e ruoli](#utenti)
10. [Il mio account](#account)
11. [Domande frequenti](#aiuto)

<a id="primi-passi"></a>

## 1. Primi passi

_Per: tutti i ruoli_

Accesso, menu e funzioni comuni a tutti.

1. Apri l'indirizzo del server (di solito **http://localhost:3000**) e accedi con nome utente e password. Al primo avvio l'amministratore è **Admin / Admin123!**.
2. Se compare l'avviso «password iniziale», vai su **Il mio account** (in basso a sinistra) e cambiala subito: almeno 8 caratteri con maiuscola, minuscola, numero e simbolo.
3. Usa il **menu a sinistra** per spostarti tra le pagine; su telefono si apre con il pulsante **☰ Menu**.
4. Il pallino **live** indica che gli aggiornamenti arrivano in diretta: quotazioni, operazioni e modifiche fatte da altri compaiono da sole, senza ricaricare.
5. La **campanella 🔔** mostra le notifiche (acquisti, vendite automatiche, avvisi). Il numero rosso indica quelle non lette.
6. Con **◐ Tema** passi dal tema scuro al chiaro; la scelta viene ricordata dal browser.

> **Suggerimento:** Ogni tabella ed elenco ha un **numero progressivo** a sinistra di ogni riga: se filtri, i numeri si riallineano da 1.

<a id="dashboard"></a>

## 2. Dashboard

_Per: Amministratore, Utente_

Il colpo d'occhio sul portafoglio.

1. In alto i **numeri chiave**: titoli in portafoglio, valore attuale, costo, utile/perdita latente, realizzato, dividendi e alert attivi.
2. **↻ Aggiorna quotazioni** riscarica subito i prezzi di tutti i titoli (altrimenti si aggiornano da soli ogni minuto).
3. Il **grafico** mostra valore e costo nel tempo e, sotto, il rendimento %: scegli 3M, 6M o 1A.
4. Sotto trovi gli **alert da controllare**, la **composizione per titolo** (con il peso massimo che hai impostato), la divisione **per settore** e i **migliori e peggiori**. Ogni voce ha il suo numero d'ordine.
5. **＋ Compra** apre l'acquisto rapido.

<a id="titoli"></a>

## 3. Titoli

_Per: Amministratore, Utente_

L'elenco completo: i tuoi titoli e tutti gli altri disponibili.

1. Nella parte alta vedi i **tuoi titoli** con quantità, prezzo medio, prezzo attuale, variazione del giorno, costo, valore, utile/perdita, peso, trend/RSI e alert.
2. Sotto, nel blocco **«Altri titoli disponibili»**, ci sono **sempre tutti i titoli** anche se non li hai comprati, ciascuno con il **prezzo reale** e la variazione del giorno. L'elenco compare subito; i prezzi si aggiornano dopo qualche istante.
3. Il campo **Filtra** cerca per nome o ticker in entrambi gli elenchi; lasciandolo vuoto li vedi tutti. A ogni apertura della pagina il filtro riparte vuoto.
4. **Compra** (su un titolo non posseduto) apre l'acquisto con quel titolo già scelto; **Aggiungi** lo inserisce nella tua lista senza comprare, per seguirlo e impostare le soglie di alert.
5. **＋ Compra** in alto sceglie il titolo con la ricerca; **🔍 Titoli** mostra l'elenco completo con i prezzi; **Nuovo titolo** serve per inserire a mano un titolo (ISIN, ticker Yahoo, valuta).
6. Su un titolo tuo: **Vendi** apre la vendita: scegli **da dove** (quote libere oppure una parte delle quote di un cliente) e **quanto** (numero di quote, importo in euro o tutto), **Modifica** apre le soglie di alert (stop, obiettivo, RSI, peso massimo, prossima revisione), **🗑** lo elimina con le sue operazioni.
7. Clicca il **nome** del titolo per aprire la scheda con grafico, RSI, MACD, medie mobili e segnali.

> **Suggerimento:** Il ticker usa il formato Yahoo Finance: AAPL, ENI.MI, VOD.L, SAP.DE. Se un prezzo risulta «datato», Yahoo non ha risposto e si vede l'ultimo prezzo salvato.

<a id="scheda-titolo"></a>

## 4. Scheda del titolo

_Per: Amministratore, Utente_

Analisi tecnica di un singolo titolo.

1. In alto i numeri: **prezzo**, quantità, valore, utile/perdita e realizzato.
2. Il grafico **Andamento** si regola con 1M, 3M, 6M, 1A e con le caselle Media 20/50/200 e Bollinger; le linee tratteggiate mostrano **stop** e **obiettivo**.
3. **RSI** e **MACD** mostrano ipercomprato/ipervenduto e momentum.
4. La lista **Segnali** riassume gli indicatori (rialzista, ribassista, neutro); la tabella **Indicatori** riporta medie, volatilità, drawdown e performance a 1M/3M/6M/1 anno.
5. **Modifica / soglie** cambia gli alert del titolo.

> **Suggerimento:** Gli indicatori sintetizzano dati storici: non sono previsioni né consigli di investimento.

<a id="operazioni"></a>

## 5. Operazioni

_Per: Amministratore, Utente_

Il registro di acquisti e vendite.

1. I **numeri** in alto riassumono operazioni, acquistato, venduto e risultato realizzato.
2. **+ Nuova operazione**: scegli il titolo, il tipo (Acquisto/Vendita), data, quantità, prezzo, cambio e commissioni.
3. Il **cambio** è «EUR per 1 unità di valuta»: per i titoli in euro scrivi 1.
4. Non serve riordinare: il sistema calcola tutto **per data**. Il costo venduto usa il prezzo medio mobile.
5. Usa il filtro in alto per vedere solo un titolo; **Modifica** e **🗑** correggono o eliminano una riga. Se un'operazione è incoerente (es. vendi più di quanto hai) viene segnalata in rosso.

<a id="alert"></a>

## 6. Alert

_Per: Amministratore, Utente_

Tutti gli avvisi attivi adesso.

1. I contatori in alto dividono gli avvisi in **critici**, **da vedere** e **obiettivi raggiunti**.
2. Filtra per livello con i pulsanti; clicca un avviso per aprire il titolo.
3. Gli avvisi nascono dalle **soglie** che imposti su ogni titolo (stop, obiettivo, valore minimo, utile/perdita, calo giornaliero, peso massimo, RSI, revisione) e da controlli automatici (quotazione mancante, sotto media 200, death cross, MACD negativo).
4. In fondo c'è lo **storico recente**; il controllo automatico gira ogni 10 minuti mentre il server è acceso.

<a id="clienti"></a>

## 7. Clienti

_Per: Amministratore, Utente_

Capitale, acquisti e rischio di ogni cliente.

1. **+ Nuovo cliente**: inserisci nome, email e, soprattutto, il **capitale** (il tetto di quanto puoi investire per lui).
2. Imposta lo **stop loss standard %** (ogni acquisto viene venduto da solo se perde quella percentuale) e la **perdita massima sul capitale %** (se il patrimonio scende oltre, si vende tutto).
3. **Compra** (o **＋ Compra per cliente**): scegli il titolo e indica **o l'importo in euro o il numero di quote** (anche frazionarie); si compra al prezzo reale e il cliente riceve una notifica. Una anteprima mostra quote ed euro, e avvisa in rosso se superi la liquidità: il server rifiuta comunque ogni importo oltre il capitale disponibile.
4. Apri un cliente per vedere **capitale, liquidità, investito, valore, utile/perdita, realizzato e patrimonio**, il grafico delle rendite e le sue allocazioni.
5. Sulle allocazioni: **Vendi** incassa al prezzo attuale e il denaro torna in liquidità; puoi vendere **tutto**, un **numero di quote** o un **importo in euro** (il resto resta al cliente, con lo stesso prezzo di ingresso e stop loss). Non si può vendere più di quanto il cliente ha: oltre le sue quote o oltre il suo valore attuale la vendita è rifiutata; se il resto sarebbe inferiore a 0,01 € si vende tutto. **Modifica** cambia importo **o quote** (si calcolano a vicenda al prezzo di ingresso) e stop, **🗑** elimina. **+ Assegna importo** attribuisce al cliente quote già presenti nel portafoglio, in euro o in quote.
6. Con lo **stop loss** o la **perdita massima** raggiunti, la vendita parte in automatico (solo con prezzi reali aggiornati) e avvisa cliente e gestore.

<a id="area-cliente"></a>

## 8. Il mio portafoglio (ruolo Cliente)

_Per: Cliente_

La vista in sola lettura dei tuoi investimenti.

1. In alto trovi **capitale, liquidità, investito, valore attuale, utile/perdita e patrimonio**.
2. Il grafico **Le mie rendite** mostra come cambia il valore nel tempo rispetto a quanto investito.
3. La tabella elenca ogni investimento con stato (aperto, venduto, stop loss), importo, valore e risultato.
4. Le **notifiche 🔔** ti avvisano quando il tuo gestore compra o quando scatta una vendita automatica.

> **Suggerimento:** I valori sono indicativi, basati sulle quotazioni di mercato e prima delle imposte.

<a id="utenti"></a>

## 9. Utenti e ruoli

_Per: Amministratore_

Solo per gli amministratori.

1. **+ Nuovo utente**: scegli il ruolo — **Amministratore** (tutto), **Utente** (solo il proprio portafoglio e i propri clienti) o **Cliente** (sola lettura, collegato a un cliente).
2. **Apri piattaforma** ti porta nel portafoglio di un utente (compri e vendi per lui) o nella vista di un cliente; il banner in alto ti riporta indietro. In alternativa usa «Portafoglio di» nel menu.
3. **Modifica** cambia nome utente, password, ruolo e stato (attivo/disattivato). Chi viene modificato esce **subito** da tutti i dispositivi.
4. **Regola degli amministratori:** qualunque admin, anche quello iniziale, si può eliminare, disattivare o declassare — compreso il **proprio account** — purché resti **almeno un altro admin attivo**.
5. Se modifichi o elimini il tuo account, vieni disconnesso e rientri con un altro amministratore.

> **Attenzione:** Eliminando un utente si eliminano anche il suo portafoglio, i clienti e le operazioni: l'app ti chiede sempre conferma.

<a id="account"></a>

## 10. Il mio account

_Per: tutti i ruoli_

Password e nome utente.

1. Apri **Il mio account** dal riquadro con il tuo nome, in basso a sinistra.
2. **Password**: inserisci quella attuale e la nuova due volte. Dopo il cambio devi rientrare (anche gli altri dispositivi escono).
3. **Nome utente**: scegline uno nuovo (3-32 caratteri: lettere, numeri, punto, trattino, underscore) e conferma con la password.

<a id="aiuto"></a>

## 11. Domande frequenti

_Per: tutti i ruoli_

Se qualcosa non torna.

1. **Un prezzo è «—» o «datato».** Yahoo Finance non ha risposto: si usa l'ultimo prezzo salvato. Puoi inserire un prezzo manuale in Modifica titolo, oppure premere ↻ Aggiorna dopo qualche minuto.
2. **Non riesco a comprare.** Controlla che il prezzo sia aggiornato (non «datato») e che l'importo non superi la liquidità del cliente.
3. **Non vedo un titolo.** Nella pagina Titoli svuota il campo Filtra: l'elenco completo riparte da vuoto.
4. **Sono uscito all'improvviso.** Qualcuno ha cambiato le tue credenziali, il tuo ruolo o ha disattivato l'account: rientra con i dati nuovi.
5. **Non posso eliminare un admin.** Deve restare almeno un altro admin attivo; crea o riattiva un altro amministratore e riprova.

> **Suggerimento:** Strumento di analisi: indicatori e alert non sono consigli di investimento.
