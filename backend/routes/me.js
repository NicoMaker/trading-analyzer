// Area del cliente (ruolo "cliente"): sola lettura delle proprie allocazioni.
// L'admin puo' aprire la stessa vista di un utente cliente con ?as=ID ("vai nella sua piattaforma").
const express = require("express");
const { get, all } = require("../db/database");
const {
  loadPortfolio,
  clientHoldings,
  clientTotals,
} = require("../services/portfolio");
const { clientSeries } = require("../services/performance");
const { wrap, HttpError } = require("./helpers");

const router = express.Router();

async function target(req) {
  let u = req.user;
  if (req.user.role === "admin") {
    const id = parseInt(req.query.as, 10);
    if (!id) throw new HttpError(400, "Indica il cliente da visualizzare");
    u = await get("SELECT * FROM users WHERE id = ? AND role = 'cliente'", [
      id,
    ]);
    if (!u) throw new HttpError(404, "Utente cliente non trovato");
  }
  if (!u.client_id)
    throw new HttpError(404, "Nessun cliente collegato a questo utente");
  const c = await get("SELECT * FROM clients WHERE id = ?", [u.client_id]);
  if (!c) throw new HttpError(404, "Cliente non trovato");
  return c;
}

router.get(
  "/portfolio",
  wrap(async (req, res) => {
    const c = await target(req);
    const [allocs, pf] = await Promise.all([
      all(
        "SELECT * FROM allocations WHERE client_id = ? ORDER BY (status = 'open') DESC, id DESC",
        [c.id],
      ),
      loadPortfolio(c.owner_id),
    ]);
    // Il cliente vede solo importi e andamento, non soglie, note o altri clienti
    const holdings = clientHoldings(allocs, pf.positions).map((h) => ({
      ...h,
      note: null,
    }));
    res.json({
      client: { name: c.name },
      holdings,
      totals: clientTotals(c, holdings),
    });
  }),
);

router.get(
  "/performance",
  wrap(async (req, res) => {
    const c = await target(req);
    res.json(
      await clientSeries(
        c.id,
        c.owner_id,
        Math.min(365, parseInt(req.query.days, 10) || 180),
      ),
    );
  }),
);

module.exports = router;
