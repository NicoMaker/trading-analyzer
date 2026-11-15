// Stato globale minimo con eventi.
const listeners = {};
export const store = {
  user: null,        // utente collegato
  ownerId: null,     // portafoglio in uso (l'admin puo' cambiarlo)
  owners: [],
  alertCounts: { danger: 0, warning: 0 },
  unread: 0,         // notifiche non lette
  on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
  off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn); },
  emit(evt, data) { (listeners[evt] || []).slice().forEach((f) => f(data)); },
};
