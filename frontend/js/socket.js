// Collegamento in tempo reale (socket.io): aggiornamenti dati, notifiche e uscita immediata se cambiano le credenziali.
import { store } from './store.js';

let socket = null;

export function connectSocket() {
  disconnectSocket();
  if (typeof io === 'undefined') return;           // libreria non caricata: l'app funziona lo stesso con il controllo periodico
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => { if (store.user && store.user.role === 'admin' && store.ownerId !== store.user.id) socket.emit('watch', store.ownerId); store.emit('socket-state', true); });
  socket.on('disconnect', () => store.emit('socket-state', false));
  socket.on('session:kicked', (msg) => store.emit('session-expired', msg));
  socket.on('portfolio:update', (d) => store.emit('data-changed', { source: 'quotes', ...d }));
  socket.on('data:changed', (d) => store.emit('data-changed', { source: 'edit', ...d }));
  socket.on('notification', (n) => store.emit('notification', n));
}

export function watchOwner(id) { if (socket && socket.connected) socket.emit('watch', id); }

export function disconnectSocket() { if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; } }
