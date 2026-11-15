const path = require('path');

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DB_FILE: process.env.DB_FILE || path.join(__dirname, 'data', 'trading.db'),
  SECRET_FILE: path.join(__dirname, 'data', '.jwt-secret'),
  FRONTEND_DIR: path.join(__dirname, '..', 'frontend'),
  // Dati di mercato: Yahoo Finance (gratuito, nessuna chiave). Gli host sono sovrascrivibili per i test.
  YAHOO_HOSTS: (process.env.YAHOO_HOSTS || 'https://query1.finance.yahoo.com,https://query2.finance.yahoo.com').split(','),
  FX_FALLBACK_URL: process.env.FX_FALLBACK_URL || 'https://api.frankfurter.dev/v1/latest',
  QUOTE_TTL_MS: parseInt(process.env.QUOTE_TTL_MS, 10) || 45 * 1000,            // dopo 45 secondi i dati in cache sono riscaricati
  REFRESH_INTERVAL_MS: parseInt(process.env.REFRESH_INTERVAL_MS, 10) || 60 * 1000, // aggiornamento automatico in background + push socket.io
  STALE_DAYS: 5,                          // quotazione piu' vecchia di N giorni = avviso
  TOKEN_TTL_HOURS: 12,
  DEFAULT_ADMIN: { username: 'Admin', password: 'Admin123!', name: 'Amministratore' },
};
