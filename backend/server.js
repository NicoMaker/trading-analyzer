const path = require("path");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const config = require("./config");
const database = require("./db/database");
const { requireAuth, requireRole, resolveOwner } = require("./middleware/auth");
const { errorHandler } = require("./routes/helpers");
const realtime = require("./realtime");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // ---- API (routes nella cartella backend/routes) ----
  app.use("/api/auth", require("./routes/auth"));
  const api = express.Router();
  api.use(requireAuth);
  api.use("/me", requireRole("cliente", "admin"), require("./routes/me"));
  api.use("/notifications", require("./routes/notifications"));
  api.use("/users", require("./routes/users"));
  // Dopo ogni modifica riuscita il server avvisa in diretta (socket.io) chi guarda quel portafoglio
  const announce = (req, res, next) => {
    if (req.method !== "GET")
      res.on("finish", () => {
        if (res.statusCode < 400 && req.ownerId)
          realtime.toOwner(req.ownerId, "data:changed", {
            by: req.user.id,
            path: req.baseUrl,
          });
      });
    next();
  };
  const staff = [requireRole("admin", "utente"), resolveOwner, announce];
  api.use("/positions", ...staff, require("./routes/positions"));
  api.use("/operations", ...staff, require("./routes/operations"));
  api.use("/clients", ...staff, require("./routes/clients"));
  api.use("/market", ...staff, require("./routes/market"));
  api.use("/alerts", ...staff, require("./routes/alerts"));
  api.use("/trade", ...staff, require("./routes/trade"));
  app.use("/api", api);
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint non trovato" }),
  );

  // ---- Frontend: index.html viene servito in automatico ----
  app.use(
    express.static(config.FRONTEND_DIR, { index: "index.html", etag: true }),
  );
  app.get("*", (req, res) =>
    res.sendFile(path.join(config.FRONTEND_DIR, "index.html")),
  );

  app.use(errorHandler);
  return app;
}

// Crea l'amministratore principale al primo avvio. Come ogni admin, puo' essere eliminato o disattivato finche' resta almeno un altro admin attivo.
async function seedAdmin() {
  const n = await database.get("SELECT COUNT(*) n FROM users");
  if (n.n > 0) return false;
  const a = config.DEFAULT_ADMIN;
  await database.run(
    "INSERT INTO users (username, name, password_hash, role, protected, must_change_password) VALUES (?,?,?,'admin',1,1)",
    [a.username, a.name, await bcrypt.hash(a.password, 10)],
  );
  return true;
}

// Server HTTP con socket.io collegato (i test usano createApp() da solo)
function createServer() {
  const server = http.createServer(createApp());
  realtime.attach(server);
  return server;
}

async function main() {
  await database.init();
  const created = await seedAdmin();
  const server = createServer();
  server.listen(config.PORT, () => {
    const url = `http://localhost:${config.PORT}`;
    console.log(`\n  Trading Analyzer avviato su ${url}`);
    if (created)
      console.log(
        `  Primo accesso -> utente: ${config.DEFAULT_ADMIN.username}  password: ${config.DEFAULT_ADMIN.password}  (cambiala dopo il login)`,
      );
    console.log("  Premi Ctrl+C per fermare il server.\n");
    require("./services/scheduler").start();
  });
  server.on("error", (e) => {
    console.error(
      e.code === "EADDRINUSE"
        ? `La porta ${config.PORT} e' occupata: avvia con PORT=3001 npm start`
        : e,
    );
    process.exit(1);
  });
}

if (require.main === module) main();
module.exports = { createApp, createServer, seedAdmin };
