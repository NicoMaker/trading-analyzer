// Genera GUIDA.md dalla stessa fonte della pagina "Guida" dell'app (frontend/js/guide-data.js).
// Uso: npm run guide
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// guide-data.js e' un modulo ES del browser: lo valuto senza dover dichiarare "type": "module" nel package
const src = readFileSync(path.join(root, "frontend/js/guide-data.js"), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src.replace("export const GUIDE", "var GUIDE"), ctx);
const GUIDE = ctx.GUIDE;

const ROLE = { admin: "Amministratore", utente: "Utente", cliente: "Cliente" };
const who = (roles) =>
  roles.length === 3 ? "tutti i ruoli" : roles.map((r) => ROLE[r]).join(", ");
const out = [
  "# Trading Analyzer — Guida di utilizzo",
  "",
  "Guida rapida per ogni ruolo: **Amministratore**, **Utente** e **Cliente**. La stessa guida è nell'app, alla voce **Guida** del menu. Per installazione, architettura e API vedi **Guida.pdf**.",
  "",
  "## Indice",
  "",
  ...GUIDE.map((s, i) => `${i + 1}. [${s.title}](#${s.id})`),
  "",
];
GUIDE.forEach((s, i) => {
  out.push(
    `<a id="${s.id}"></a>`,
    "",
    `## ${i + 1}. ${s.title}`,
    "",
    `_Per: ${who(s.roles)}_`,
    "",
    s.lead,
    "",
    ...s.steps.map((t, n) => `${n + 1}. ${t}`),
    "",
  );
  if (s.tip)
    out.push(`> **${s.warn ? "Attenzione" : "Suggerimento"}:** ${s.tip}`, "");
});
writeFileSync(path.join(root, "GUIDA.md"), out.join("\n"));
console.log(`GUIDA.md aggiornata (${GUIDE.length} sezioni)`);
