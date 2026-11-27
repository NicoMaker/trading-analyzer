#!/usr/bin/env python3
"""Genera Guida.pdf (guida completa: uso, installazione, architettura, API).

La sezione «Guida all'uso» legge frontend/js/guide-data.js, la stessa fonte della pagina Guida
dell'app e di GUIDA.md, cosi' i tre documenti non si scostano tra loro.

Uso:  pip install reportlab && python3 scripts/build-guide-pdf.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle, NextPageTemplate, Preformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Guida.pdf"
VERSION = "3.0 — novembre 2026"

# ───────── dati dal progetto ─────────
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
NODE_MIN = re.search(r"(\d+)", pkg["engines"]["node"]).group(1)
EXPRESS = re.search(r"(\d+)", pkg["dependencies"]["express"]).group(1)
SOCKETIO = re.search(r"(\d+)", pkg["dependencies"]["socket.io"]).group(1)
APP_VERSION = pkg["version"]

js = (
    "const vm=require('vm'),fs=require('fs');const c=vm.createContext({});"
    "vm.runInContext(fs.readFileSync('frontend/js/guide-data.js','utf8')"
    ".replace('export const GUIDE','var GUIDE'),c);"
    "process.stdout.write(JSON.stringify(c.GUIDE))"
)
GUIDE = json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))

# ───────── font ─────────
FD = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("Sans", FD + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Sans-B", FD + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Sans-I", FD + "DejaVuSans-Oblique.ttf"))
pdfmetrics.registerFont(TTFont("Mono", FD + "DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans-I", boldItalic="Sans-B")

# ───────── colori e stili ─────────
NAVY = colors.HexColor("#0b1330")
BLUE = colors.HexColor("#2f6bff")
CYAN = colors.HexColor("#17b6d6")
INK = colors.HexColor("#1b2238")
MUTE = colors.HexColor("#5d6783")
LINE = colors.HexColor("#d9deeb")
SOFT = colors.HexColor("#f2f5fc")
WARN_BG, WARN_BR = colors.HexColor("#fff4e0"), colors.HexColor("#e29a1c")
TIP_BG, TIP_BR = colors.HexColor("#e8f2ff"), BLUE

S = {}
S["body"] = ParagraphStyle("body", fontName="Sans", fontSize=9.2, leading=13.6, textColor=INK, alignment=TA_LEFT, spaceAfter=5)
S["small"] = ParagraphStyle("small", parent=S["body"], fontSize=8, leading=11, textColor=MUTE, spaceAfter=0)
S["h1"] = ParagraphStyle("h1", fontName="Sans-B", fontSize=21, leading=26, textColor=NAVY, spaceAfter=3)
S["sub"] = ParagraphStyle("sub", fontName="Sans", fontSize=10.5, leading=14, textColor=MUTE, spaceAfter=12)
S["h2"] = ParagraphStyle("h2", fontName="Sans-B", fontSize=12.4, leading=16, textColor=BLUE, spaceBefore=10, spaceAfter=5)
S["h3"] = ParagraphStyle("h3", fontName="Sans-B", fontSize=10.4, leading=14, textColor=NAVY, spaceBefore=8, spaceAfter=3)
S["role"] = ParagraphStyle("role", fontName="Sans-B", fontSize=7.4, leading=10, textColor=MUTE, spaceAfter=4)
S["cell"] = ParagraphStyle("cell", parent=S["body"], fontSize=8.4, leading=11.6, spaceAfter=0)
S["cellb"] = ParagraphStyle("cellb", parent=S["cell"], fontName="Sans-B", textColor=NAVY)
S["th"] = ParagraphStyle("th", parent=S["cell"], fontName="Sans-B", textColor=colors.white)
S["bul"] = ParagraphStyle("bul", parent=S["body"], leftIndent=13, bulletIndent=2, spaceAfter=3)
S["toc1"] = ParagraphStyle("toc1", fontName="Sans", fontSize=10, leading=19, textColor=INK, leftIndent=0)
S["tocT"] = ParagraphStyle("tocT", fontName="Sans-B", fontSize=21, leading=26, textColor=NAVY, spaceAfter=14)


def clean(t: str) -> str:
    """Testo della guida -> markup reportlab (niente emoji: il font PDF non le ha)."""
    t = (t.replace("**🗑**", "**Elimina**").replace("**🔔**", "**campanella**")
          .replace("**campanella 🔔**", "**campanella**").replace("＋", "+"))
    t = re.sub(r"[\U00010000-\U0010ffff\ufe0f]", "", t)
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*([^*]+)\*\*", lambda m: f"<b>{m.group(1).strip()}</b>", t)
    t = t.replace("<b></b>", "")
    return re.sub(r" {2,}", " ", t)


def P(t, st="body"):
    return Paragraph(clean(t), S[st])


def bullets(items):
    return [Paragraph(clean(i), S["bul"], bulletText="•") for i in items]


def callout(text, warn=False):
    bg, br = (WARN_BG, WARN_BR) if warn else (TIP_BG, TIP_BR)
    label = "Attenzione. " if warn else "Suggerimento. "
    p = Paragraph(f"<b>{label}</b>{clean(text)}", S["cell"])
    t = Table([[p]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 2.4, br),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 7)]


def table(rows, widths, head=True, bold_first=True):
    data = []
    for i, r in enumerate(rows):
        row = []
        for j, c in enumerate(r):
            st = "th" if (head and i == 0) else ("cellb" if (bold_first and j == 0) else "cell")
            row.append(Paragraph(clean(c), S[st]))
        data.append(row)
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if head else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if head:
        style += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
    style += [("BACKGROUND", (0, k), (-1, k), SOFT) for k in range(2 if head else 1, len(rows), 2)]
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 8)]


def code(text):
    t = Table([[Preformatted(text, ParagraphStyle("c", fontName="Mono", fontSize=8, leading=11, textColor=colors.HexColor("#e6ecff")))]],
              colWidths=[170 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    return [t, Spacer(1, 8)]


def steps(items):
    rows = [[Paragraph(f"<b>{i}</b>", ParagraphStyle("n", parent=S["cell"], textColor=BLUE, alignment=1)), P(t, "cell")]
            for i, t in enumerate(items, 1)]
    t = Table(rows, colWidths=[9 * mm, 161 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.3, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [t, Spacer(1, 5)]


class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, title="Trading Analyzer — Guida completa",
                         author="Trading Analyzer",
                         subject="Guida all'uso, installazione, architettura e API", **kw)
        fr = Frame(20 * mm, 20 * mm, 170 * mm, 250 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[fr], onPage=cover_page),
            PageTemplate(id="main", frames=[fr], onPage=main_page),
        ])
        self.n = 0

    def beforeDocument(self):
        self.n = 0  # multiBuild rifa piu' passate: i segnalibri devono avere sempre gli stessi nomi

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name == "secTitle":
            self.n += 1
            key = f"s{self.n}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.getPlainText(), key, 0)
            self.notify("TOCEntry", (0, f.getPlainText(), self.page, key))


def cover_page(c, d):
    w, h = A4
    c.setFillColor(NAVY)
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.rect(0, h - 8 * mm, w, 8 * mm, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.rect(0, h - 8 * mm, w * 0.28, 8 * mm, fill=1, stroke=0)
    # grafico decorativo
    pts = [(30, 70), (62, 95), (88, 80), (118, 118), (148, 104), (178, 142)]
    c.setStrokeColor(CYAN)
    c.setLineWidth(2.2)
    p = c.beginPath()
    p.moveTo(pts[0][0] * mm, pts[0][1] * mm + 40 * mm)
    for x, y in pts[1:]:
        p.lineTo(x * mm, y * mm + 40 * mm)
    c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(colors.white)
    c.setFont("Sans-B", 40)
    c.drawString(24 * mm, h - 70 * mm, "Trading")
    c.drawString(24 * mm, h - 86 * mm, "Analyzer")
    c.setFont("Sans", 13)
    c.setFillColor(colors.HexColor("#b9c6ee"))
    c.drawString(24 * mm, h - 100 * mm, "Guida completa all'uso, all'installazione,")
    c.drawString(24 * mm, h - 107 * mm, "all'architettura e alle API")
    y = 90 * mm
    for k, v in [("VERSIONE GUIDA", VERSION), ("APPLICAZIONE", f"trading-analyzer {APP_VERSION} (MIT)"),
                 ("REPOSITORY", "github.com/NicoMaker/trading-analyzer"), ("REQUISITI", f"Node.js {NODE_MIN} o superiore")]:
        c.setFont("Sans-B", 7.5)
        c.setFillColor(CYAN)
        c.drawString(24 * mm, y, k)
        c.setFont("Sans", 10.5)
        c.setFillColor(colors.white)
        c.drawString(70 * mm, y, v)
        y -= 11 * mm
    c.setFont("Sans-I", 8)
    c.setFillColor(colors.HexColor("#8b97bd"))
    c.drawString(24 * mm, 18 * mm, "Strumento di analisi: indicatori e alert non costituiscono consigli di investimento.")


def main_page(c, d):
    w, h = A4
    c.setFont("Sans-B", 8)
    c.setFillColor(NAVY)
    c.drawString(20 * mm, h - 12 * mm, "Trading Analyzer")
    c.setFont("Sans", 8)
    c.setFillColor(MUTE)
    c.drawRightString(w - 20 * mm, h - 12 * mm, "Guida completa")
    c.setStrokeColor(LINE)
    c.line(20 * mm, h - 14 * mm, w - 20 * mm, h - 14 * mm)
    c.drawString(20 * mm, 11 * mm, "github.com/NicoMaker/trading-analyzer")
    c.drawRightString(w - 20 * mm, 11 * mm, f"Pagina {d.page}")


# ───────── contenuto ─────────
story = [NextPageTemplate("main"), PageBreak()]
toc = TableOfContents()
toc.levelStyles = [S["toc1"]]
toc.dotsMinLevel = 0
story += [Paragraph("Indice", S["tocT"]), toc]


def section(num, title, sub):
    S.setdefault("secTitle", ParagraphStyle("secTitle", parent=S["h1"]))
    return [PageBreak(), Paragraph(f"{num}. {title}", S["secTitle"]), Paragraph(sub, S["sub"])]


# 1 ─ Panoramica
story += section(1, "Panoramica", "Cos'è Trading Analyzer e cosa sa fare")
story += [P("Trading Analyzer è un'applicazione web per analizzare il portafoglio azionario in tempo reale. Combina quotazioni reali, alert su soglie personali, gestione di utenti con ruoli e allocazione di importi in euro ai clienti. La logica deriva dal foglio Controllo_azioni.xlsx (prezzo medio mobile, stop, obiettivo, peso massimo, revisione, quotazioni mancanti, controlli sulle operazioni), ma qui i dati sono scaricati automaticamente."),
          P("Funzioni principali", "h2")]
story += bullets([
    "**Tempo reale con socket.io:** quotazioni aggiornate ogni 60 secondi dal server e inviate a tutti i client; ogni modifica compare subito sugli altri dispositivi.",
    "**Portafoglio e operazioni:** prezzo medio mobile, utile/perdita latente e realizzato, dividendi, controlli di coerenza (es. vendita oltre le quote possedute).",
    "**Acquisti e vendite a prezzo di mercato:** per importo in euro o per numero di quote (anche frazionarie), dalle quote libere o dall'allocazione di un cliente.",
    "**Analisi tecnica:** RSI, MACD, medie mobili 20/50/200, bande di Bollinger, volatilità, drawdown e performance a 1M/3M/6M/1A.",
    "**Alert multipli** sempre visibili insieme, con notifiche in diretta e storico recente.",
    "**Clienti e capitale:** stop loss standard, perdita massima sul capitale e vendita forzata automatica.",
    "**Tre ruoli** (amministratore, utente, cliente), notifiche con campanella, tema scuro/chiaro, interfaccia responsiva con barra a schede su telefono e installabile come app (PWA).",
])
story += [P("Tecnologie", "h2")]
story += table([
    ["Livello", "Tecnologia", "Note"],
    ["Server", f"Node.js ≥ {NODE_MIN} + Express {EXPRESS}", "API REST sotto /api; serve anche il frontend statico"],
    ["Database", "SQLite3", "File backend/data/trading.db, creato al primo avvio; migrazione automatica dei database precedenti"],
    ["Tempo reale", f"socket.io {SOCKETIO}", "Stanze per portafoglio; evento data:changed dopo ogni modifica"],
    ["Autenticazione", "JWT + cookie httpOnly, bcryptjs", "Sessione di 12 ore, ruoli, invalidazione immediata, blocco dopo 5 tentativi falliti"],
    ["Dati di mercato", "Yahoo Finance + Frankfurter (BCE)", "Gratuiti, senza chiave API; cambi con riserva BCE"],
    ["Frontend", "JavaScript ES modules, HTML, CSS", "Nessuna fase di build; grafici in SVG; font Inter locale; guida integrata"],
], [32, 56, 82])

# 2 ─ Installazione
story += section(2, "Installazione e avvio", "Dal clone del repository al primo accesso")
story += [P("Requisiti", "h2")]
story += bullets([f"Node.js {NODE_MIN} o superiore (consigliata la versione LTS) e npm.",
                  "Connessione a internet per le quotazioni (senza, l'app usa l'ultimo dato salvato).",
                  "Un browser moderno: Chrome, Edge, Firefox, Safari."])
story += [P("Avvio rapido", "h2")]
story += code("git clone https://github.com/NicoMaker/trading-analyzer.git\ncd trading-analyzer\nnpm install\nnpm start")
story += [P("Il server parte su http://localhost:3000 e serve frontend/index.html. Il browser non si apre da solo: vai tu all'indirizzo. Per usare un'altra porta: PORT=3001 npm start (su Windows PowerShell: $env:PORT=3001; npm start).")]
story += callout("Primo accesso: utente Admin, password Admin123!. Cambiala subito da «Il mio account»: la password deve avere almeno 8 caratteri con maiuscola, minuscola, numero e simbolo.", warn=True)
story += [P("Comandi npm", "h2")]
story += table([
    ["Comando", "Cosa fa"],
    ["npm start", "Avvia il server (node backend/server.js)"],
    ["npm run dev", "Avvia con riavvio automatico a ogni modifica (node --watch)"],
    ["npm test", "Esegue i test automatici: backend/tests/unit.js e backend/tests/api.js (node --test)"],
    ["npm run seed", "Carica dati di esempio: utente demo, 8 titoli, operazioni, 3 clienti con allocazioni (vedi sotto)"],
    ["npm run guide", "Rigenera GUIDA.md dalla guida integrata nell'app (frontend/js/guide-data.js)"],
], [45, 125])
story += [P("Dati di esempio", "h2"),
          P("Per vedere l'app popolata senza inserire nulla a mano: npm run seed. Il comando aggiunge l'utente demo con 8 titoli (USA, Italia, Europa, ETF), 22 operazioni degli ultimi mesi, 3 clienti con allocazioni aperte e una già venduta, notifiche di esempio e un anno di quotazioni inventate, così funziona anche offline. Con la rete le quotazioni vere sostituiscono quelle di esempio.")]
story += table([
    ["Utente", "Password", "Ruolo"],
    ["demo", "Demo123!", "Utente (gestisce titoli, operazioni e clienti)"],
    ["mario.rossi", "Cliente123!", "Cliente (sola lettura, allocazioni di Mario Rossi)"],
    ["giulia.bianchi", "Cliente123!", "Cliente (sola lettura, allocazioni di Giulia Bianchi)"],
], [40, 36, 94])
story += bullets([
    "Se i dati demo ci sono già il comando non fa nulla; npm run seed -- --reset li cancella e li ricrea (tocca solo quelli demo).",
    "Per provare su un database separato: DB_FILE=/tmp/prova.db npm run seed, poi DB_FILE=/tmp/prova.db npm start.",
    "I prezzi sono inventati e ripetibili: non usare i dati demo per decisioni reali. Per toglierli elimina l'utente demo dalla pagina Utenti (con lui spariscono i suoi dati).",
])
story += [P("Variabili d'ambiente", "h2")]
story += table([
    ["Variabile", "Default", "Significato"],
    ["PORT", "3000", "Porta del server"],
    ["DB_FILE", "backend/data/trading.db", "Percorso del database SQLite"],
    ["YAHOO_HOSTS", "query1/query2.finance.yahoo.com", "Host Yahoo separati da virgola (utile nei test)"],
    ["FX_FALLBACK_URL", "api.frankfurter.dev/v1/latest", "Servizio di riserva per i cambi"],
    ["QUOTE_TTL_MS", "45000", "Oltre questa età le quotazioni in cache vengono riscaricate"],
    ["REFRESH_INTERVAL_MS", "60000", "Intervallo dell'aggiornamento automatico + push socket.io"],
], [45, 55, 70])
story += [P("Valori fissi in backend/config.js: una quotazione più vecchia di 5 giorni genera un avviso; la sessione dura 12 ore. Il segreto JWT viene generato al primo avvio in backend/data/.jwt-secret.")]
story += callout("Se l'installazione di sqlite3 fallisce, verifica la versione di Node e di avere una connessione attiva: il pacchetto scarica un binario precompilato.")

# 3 ─ Architettura
story += section(3, "Architettura", "Come è organizzato il codice e come fluiscono i dati")
story += [P("Struttura delle cartelle", "h2")]
story += code("""backend/
  server.js          avvio Express, creazione admin, intestazioni di sicurezza, serve il frontend
  config.js          porte, API, tempi
  realtime.js        socket.io: stanze per portafoglio, evento data:changed
  db/database.js     SQLite3: schema, migrazioni e funzioni
  db/schema/         schema.mmd (Mermaid) e schema.png
  middleware/auth.js sessioni (cookie httpOnly + JWT), ruoli
  routes/            auth, users, positions, operations, clients, market,
                     alerts, trade, me, notifications
  services/          market, indicators, portfolio, performance, trading,
                     alerts, catalog, notify, scheduler
  tests/             unit.js, api.js (usati da npm test)
  data/              database SQLite (creato al primo avvio)
frontend/
  index.html, manifest.webmanifest, icon.svg
  css/               base.css, components.css, futuristic.css
  js/                app.js (router), api.js, store.js, utils.js, socket.js, guide-data.js
  js/components/     login, navbar, dashboard, positions, stock-detail, operations,
                     alerts, clients, users, chart, ui, trade, search,
                     notifications, perf, guide
scripts/             build-guide.mjs (GUIDA.md), build-guide-pdf.py (Guida.pdf)""")
story += [P("Flusso di una richiesta", "h2")]
story += table([
    ["", "Passaggio"],
    ["1", "Il browser chiama /api/... con il cookie di sessione httpOnly."],
    ["2", "requireAuth verifica il JWT e rilegge l'utente dal database; requireRole controlla il ruolo (admin / utente / cliente)."],
    ["3", "resolveOwner stabilisce di quale portafoglio si parla: l'utente vede solo il proprio, l'admin può scegliere «Portafoglio di»."],
    ["4", "La route usa i services (portafoglio, indicatori, trading, alert) e il database SQLite."],
    ["5", "Dopo ogni modifica riuscita viene emesso data:changed via socket.io: gli altri dispositivi si aggiornano da soli."],
], [10, 160])
story += [P("Processi in background", "h2")]
story += table([
    ["Processo", "Frequenza", "Effetto"],
    ["Aggiornamento quotazioni", "60 s", "Scarica prezzi e cambi dei titoli aperti, aggiorna la cache SQLite e avvisa via socket.io i client collegati"],
    ["Controllo rischio (vendita forzata)", "a ogni aggiornamento", "Vende quando scatta stop loss o perdita massima, solo con prezzo reale aggiornato"],
    ["Controllo alert", "a ogni aggiornamento", "Valuta soglie e controlli automatici; ogni avviso nuovo è registrato nello storico e notificato una sola volta al giorno per titolo e tipo"],
    ["Polling client", "60 s", "Aggiorna il contatore alert nel menu"],
], [52, 34, 84])
story += callout("Nelle versioni precedenti di questa guida il controllo alert risultava «ogni 10 minuti»: oggi viaggia insieme all'aggiornamento delle quotazioni (60 s per impostazione predefinita, modificabile con REFRESH_INTERVAL_MS).")

# 4 ─ Ruoli
story += section(4, "Ruoli e permessi", "Chi può fare cosa")
story += table([
    ["Ruolo", "Ambito", "Può"],
    ["Amministratore", "Tutta la piattaforma", "Tutto: crea, modifica, elimina e disattiva utenti; con «Portafoglio di» vede e gestisce i dati di qualsiasi utente; «Apri piattaforma» entra come quell'utente o nella vista di un cliente"],
    ["Utente", "Solo il proprio", "Gestisce portafoglio, operazioni, alert, clienti e allocazioni propri"],
    ["Cliente", "Sola lettura", "Vede le proprie allocazioni, il grafico delle rendite e le notifiche; è collegato a un cliente"],
], [30, 34, 106])
story += [P("Regole sugli account", "h2")]
story += bullets([
    "Password di almeno 8 caratteri con maiuscola, minuscola, numero e simbolo; nome utente di 3-32 caratteri (lettere, numeri, punto, trattino, underscore).",
    "Qualsiasi admin (anche quello iniziale) può essere eliminato, disattivato o declassato, purché resti almeno un altro admin attivo.",
    "Cambiando nome utente, password, ruolo o stato di un account, quell'utente esce subito da tutti i dispositivi (socket.io).",
    "Eliminando un utente si eliminano anche portafoglio, clienti e operazioni: l'app chiede sempre conferma.",
])

# 5 ─ Guida all'uso (da guide-data.js)
ROLE = {"admin": "Amministratore", "utente": "Utente", "cliente": "Cliente"}
story += section(5, "Guida all'uso, pagina per pagina", "Tutto quello che si può fare dal menu (stessa guida dell'app e di GUIDA.md)")
for i, s in enumerate(GUIDE, 1):
    who = "TUTTI I RUOLI" if len(s["roles"]) == 3 else ", ".join(ROLE[r].upper() for r in s["roles"])
    block = [P(f"5.{i} {s['title']}", "h2"), P(f"PER: {who}", "role"), P(s["lead"])] + steps(s["steps"])
    if s.get("tip"):
        block += callout(s["tip"], warn=bool(s.get("warn")))
    story += [KeepTogether(block[:3])] + block[3:]

# 6 ─ Logica di calcolo
story += section(6, "Logica di calcolo", "Come l'app ragiona su prezzi, alert e rischio")
story += [P("Portafoglio e prezzo medio mobile", "h2"),
          P("Le operazioni sono elaborate in ordine di data. Ad ogni acquisto il prezzo medio si aggiorna in base a quantità, prezzo, cambio e commissioni; ad ogni vendita il costo venduto usa il prezzo medio mobile del momento. Da qui derivano costo, valore, utile/perdita latente e realizzato. Per i titoli in valuta estera il cambio è «EUR per 1 unità di valuta»."),
          P("Alert configurabili per titolo", "h2")]
story += table([
    ["Soglia", "Si attiva quando"],
    ["Stop", "il prezzo scende al livello impostato"],
    ["Obiettivo", "il prezzo raggiunge il target"],
    ["Valore posizione", "il valore scende sotto X €"],
    ["Utile / perdita", "il risultato scende sotto X %"],
    ["Calo giornaliero", "la variazione del giorno supera la soglia negativa"],
    ["Peso massimo", "il titolo supera la quota di portafoglio impostata"],
    ["RSI", "l'indicatore supera le soglie di ipercomprato/ipervenduto"],
    ["Prossima revisione", "arriva la data di revisione impostata"],
], [45, 125])
story += [P("Controlli automatici", "h2")]
story += bullets(["Quotazione mancante o datata (oltre 5 giorni).", "Allocazioni che superano il costo della posizione.",
                  "Prezzo sotto la media a 200 giorni.", "Death cross (media 50 sotto la media 200).", "MACD negativo."])
story += [P("Indicatori tecnici", "h2")]
story += table([
    ["Indicatore", "Uso"],
    ["RSI", "Misura ipercomprato / ipervenduto"],
    ["MACD", "Momentum e cambi di tendenza"],
    ["Medie mobili 20 / 50 / 200", "Trend di breve, medio e lungo periodo"],
    ["Bande di Bollinger", "Volatilità rispetto alla media"],
    ["Volatilità e drawdown", "Rischio storico e massima discesa"],
    ["Performance 1M / 3M / 6M / 1A", "Rendimento su finestre temporali"],
], [60, 110])
story += [P("Acquisti, vendite e vendita forzata", "h2")]
story += bullets([
    "L'acquisto si indica in euro **oppure** in quote (mai entrambi, sempre > 0, minimo 0,01 €) e avviene al prezzo reale; le quote possono essere frazionarie.",
    "Il capitale cliente è il tetto di investimento: non si può comprare oltre la liquidità.",
    "La vendita può riguardare tutto, un numero di quote o un importo in euro, mai oltre quanto posseduto; se il resto sarebbe sotto 0,01 € si vende tutto. L'incasso torna in liquidità.",
    "Se un'allocazione perde la percentuale di stop loss, o il patrimonio del cliente scende oltre la perdita massima, viene venduto tutto in automatico (solo con prezzo reale aggiornato) e si avvisano cliente e gestore.",
])
story += callout("Indicatori e alert sintetizzano dati storici: non sono previsioni né consigli di investimento.", warn=True)

# 7 ─ Dati di mercato
story += section(7, "Dati di mercato", "Fonti, cache e comportamento in caso di errore")
story += bullets([
    "**Yahoo Finance** (gratuito, senza chiave): quotazioni, storico a 1 anno, ricerca per nome, ticker o ISIN.",
    "**Cambi** da Yahoo con riserva Frankfurter (BCE).",
    "**Cache SQLite:** i dati più vecchi di 45 secondi (QUOTE_TTL_MS) vengono riscaricati; in background si aggiorna ogni 60 secondi. Se l'API non risponde si usa l'ultimo dato salvato o il prezzo manuale.",
    "La ricerca «Cerca titolo» senza testo mostra tutti i titoli (i tuoi + circa 45 aziende reali di USA, Italia, Europa ed ETF); scrivendo si cerca su tutto Yahoo.",
    "Il ticker segue il formato Yahoo: AAPL, ENI.MI, VOD.L, SAP.DE; dalla ricerca si compila da solo.",
])
story += callout("Yahoo è un servizio non ufficiale: può cambiare o limitare le richieste. In quel caso i prezzi risultano «datati» e gli acquisti sono bloccati finché non torna un prezzo reale.", warn=True)

# 8 ─ API
story += section(8, "Riferimento API REST", "Endpoint disponibili (tutti sotto /api)")
story += [P("Tutte le rotte, tranne /auth/login, richiedono una sessione valida. Le rotte «staff» sono per admin e utente e agiscono sul portafoglio selezionato (per l'admin con ?owner=ID); ogni scrittura riuscita genera l'evento socket.io data:changed. Nella colonna Metodo, DEL = DELETE.")]
story += table([
    ["Metodo", "Percorso", "Scopo"],
    ["POST", "/auth/login · /auth/logout", "Accesso e uscita"],
    ["GET", "/auth/me", "Utente corrente"],
    ["POST", "/auth/change-password · /auth/change-username", "Cambio credenziali"],
    ["GET", "/positions", "Elenco posizioni"],
    ["POST · PUT · DEL", "/positions · /positions/:id", "Crea, modifica, elimina titolo"],
    ["GET", "/positions/performance", "Andamento del portafoglio"],
    ["GET", "/positions/:id/analysis", "Analisi tecnica del titolo"],
    ["GET · POST", "/operations", "Elenco e nuova operazione"],
    ["PUT · DEL", "/operations/:id", "Modifica / elimina operazione"],
    ["GET · POST", "/clients", "Elenco e nuovo cliente"],
    ["GET · PUT · DEL", "/clients/:id", "Dettaglio, modifica, elimina"],
    ["GET", "/clients/:id/performance", "Rendite del cliente"],
    ["GET", "/clients/allocations/summary", "Riepilogo allocazioni"],
    ["POST", "/clients/:id/allocations", "Assegna importo (euro o quote)"],
    ["PUT · DEL", "/clients/allocations/:aid", "Modifica / elimina allocazione"],
    ["POST", "/trade/buy", "Acquisto in euro o quote, con cliente opzionale"],
    ["POST", "/trade/sell", "Vendita di quote libere (quote, euro o tutto)"],
    ["POST", "/trade/close/:allocationId", "Vendita di un'allocazione (tutta o in parte)"],
    ["GET", "/trade/position/:positionId/allocations", "Allocazioni aperte dei clienti su un titolo"],
    ["GET", "/market/catalog · /market/search", "Catalogo e ricerca titoli"],
    ["GET", "/market/quote/:symbol · /market/price-at", "Quotazione e prezzo storico"],
    ["POST", "/market/refresh", "Aggiorna subito le quotazioni"],
    ["GET", "/alerts", "Alert attivi e storico"],
    ["GET", "/notifications", "Elenco notifiche"],
    ["POST", "/notifications/read-all · /notifications/:id/read", "Segna come lette"],
    ["GET", "/me/portfolio · /me/performance", "Area cliente (cliente e admin)"],
    ["GET · POST", "/users", "Elenco e nuovo utente (solo admin)"],
    ["GET", "/users/owners", "Portafogli selezionabili (solo admin)"],
    ["PUT · DEL", "/users/:id", "Modifica / elimina utente (solo admin)"],
], [33, 78, 59])

# 9 ─ Sicurezza
story += section(9, "Sicurezza e buone pratiche", "Cosa fa già l'app e cosa fare in produzione")
story += [P("Già previsto", "h2")]
story += bullets([
    "Sessione con cookie httpOnly e SameSite=Strict + JWT (12 ore); password salvate con hash bcrypt.",
    "Blocco del login dopo 5 tentativi errati per utente e indirizzo IP (1 minuto).",
    "Controllo ruoli a ogni richiesta, utente riletto dal database, isolamento dei portafogli per proprietario.",
    "Invalidazione immediata della sessione al cambio di credenziali, ruolo o stato (anche sui socket aperti).",
    "Intestazioni di sicurezza: Content-Security-Policy restrittiva (solo risorse dello stesso sito), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, Permissions-Policy, Cross-Origin-Opener-Policy.",
    "Corpo delle richieste JSON limitato a 100 kB; conferme per le azioni distruttive.",
])
story += [P("Consigli per l'uso reale", "h2")]
story += bullets([
    "Cambia subito la password dell'admin iniziale.",
    "Pubblica l'app dietro un reverse proxy con HTTPS (nginx, Caddy): non esporre la porta 3000 su internet in chiaro. Il cookie di sessione non ha l'attributo Secure, quindi senza HTTPS potrebbe viaggiare in chiaro.",
    "Fai backup periodico di backend/data/ (database e segreto JWT) e non versionarlo.",
    "Limita l'accesso alla rete e tieni aggiornate le dipendenze (npm audit).",
])

# 10 ─ Interfaccia
story += section(10, "Interfaccia e PWA", "Come è fatto il frontend")
story += [P("Il frontend non ha fasi di build: ES modules caricati direttamente dal browser. Il font Inter è servito in locale (pacchetto @fontsource-variable/inter) perché la Content-Security-Policy blocca Google Fonts. Gli stili sono tre file caricati in quest'ordine da index.html: base.css (token e layout), components.css (componenti) e futuristic.css (effetti: griglia luminosa, vetro, carta «saldo», bordi di luce).")]
story += table([
    ["Area", "Novità"],
    ["Tema", "Scuro e chiaro, scelta ricordata dal browser; segue la preferenza del sistema al primo accesso"],
    ["Mobile", "Barra a schede in basso con quattro voci e «Altro» per il menu completo; form lunghi con barra Salva sempre visibile; safe area per notch"],
    ["Tempo reale", "Pallino live, notifiche con campanella, aggiornamenti a schermo da socket.io"],
    ["Grafici", "SVG, senza librerie: andamento valore/costo, rendimento %, RSI, MACD, medie e bande di Bollinger"],
    ["PWA", "manifest.webmanifest + icona SVG: installabile come app su telefono e desktop"],
    ["Guida", "Pagina «Guida» filtrata per ruolo, con indice e pulsante Stampa"],
    ["Stampa", "Stili puliti senza sfondi e sfocature"],
], [34, 136])
story += callout("modern.css e bank.css, ancora presenti in frontend/css, sono stati sostituiti da futuristic.css e non sono più caricati da index.html: si possono eliminare.")

# 11 ─ Database
story += section(11, "Database", "SQLite: tabelle principali (schema completo in backend/db/schema/)")
story += table([
    ["Tabella", "Contenuto"],
    ["users", "Account con ruolo (admin / utente / cliente), stato attivo, cambio password obbligatorio, token_version per invalidare le sessioni"],
    ["clients", "Clienti del gestore: capitale, stop loss standard %, perdita massima %"],
    ["positions", "Titoli del portafoglio: ISIN, ticker Yahoo, valuta, settore, soglie di alert"],
    ["operations", "Registro di acquisti e vendite (quantità, prezzo, cambio, commissioni)"],
    ["allocations", "Importi assegnati ai clienti: prezzo di ingresso, stop loss, stato (aperta, venduta, stop loss)"],
    ["notifications", "Notifiche per utente, con stato letto/non letto"],
    ["alert_log", "Storico alert, una riga al giorno per titolo e tipo"],
    ["market_cache · fx_cache", "Cache di quotazioni, storico e cambi"],
], [40, 130])
story += [P("I database creati con versioni precedenti vengono aggiornati da soli all'avvio.")]

# 12 ─ Test
story += section(12, "Test e sviluppo", "Come verificare che tutto funzioni")
story += bullets([
    "npm test esegue con il runner integrato di Node (node --test) i test unitari (indicatori, ricostruzione del registro operazioni, alert, regole su importi e quote) e i test delle API sul server reale con database temporaneo.",
    "npm run dev riavvia il server a ogni modifica dei file backend.",
    "npm run seed prepara un database di prova con dati realistici.",
    "Dopo aver modificato frontend/js/guide-data.js esegui npm run guide per aggiornare GUIDA.md; per Guida.pdf: pip install reportlab e python3 scripts/build-guide-pdf.py.",
    "Per provare senza rete, YAHOO_HOSTS permette di puntare a un server finto: è ciò che fanno i test.",
])

# 13 ─ FAQ
story += section(13, "Domande frequenti e risoluzione problemi", "Se qualcosa non torna")
faq = [
    ("Un prezzo è «—» o «datato».", "Yahoo Finance non ha risposto: si usa l'ultimo prezzo salvato. Inserisci un prezzo manuale in Modifica titolo oppure premi Aggiorna dopo qualche minuto."),
    ("Non riesco a comprare.", "Controlla che il prezzo sia aggiornato (non «datato») e che l'importo non superi la liquidità del cliente."),
    ("Non vedo un titolo.", "Nella pagina Titoli svuota il campo Filtra: l'elenco completo riparte da vuoto."),
    ("Sono uscito all'improvviso.", "Qualcuno ha cambiato le tue credenziali o il tuo ruolo, o ha disattivato l'account: rientra con i dati nuovi."),
    ("«Troppi tentativi».", "Dopo 5 password sbagliate l'accesso è bloccato per 1 minuto: attendi e riprova."),
    ("Non posso eliminare un admin.", "Deve restare almeno un altro admin attivo: crea o riattiva un altro amministratore e riprova."),
    ("La porta 3000 è occupata.", "Avvia con un'altra porta: PORT=3001 npm start."),
    ("Errore in npm install.", f"Verifica Node ≥ {NODE_MIN}, rete attiva e prova a rimuovere node_modules e rieseguire l'installazione."),
    ("Ho perso la password dell'unico admin.", "Ferma il server e rinomina backend/data/trading.db per ripartire con l'admin iniziale (perdi i dati: fai prima un backup)."),
]
for q, a in faq:
    story.append(KeepTogether([P(q, "h3"), P(a)]))
story += callout("Strumento di analisi: indicatori e alert non sono consigli di investimento. Licenza del progetto: MIT.")

doc = Doc(str(OUT))
doc.multiBuild(story)
print("OK", OUT, f"({doc.page} pagine)")
