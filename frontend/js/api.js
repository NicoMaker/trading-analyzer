import { store } from "./store.js";

// Client API: aggiunge da solo ?owner= quando l'admin guarda il portafoglio di un altro utente
// e porta al login quando la sessione scade.
async function request(method, url, body, { noOwner = false } = {}) {
  let u = "/api" + url;
  if (
    !noOwner &&
    store.ownerId &&
    store.user &&
    store.user.role === "admin" &&
    store.ownerId !== store.user.id &&
    !url.startsWith("/users") &&
    !url.startsWith("/auth") &&
    !url.startsWith("/me") &&
    !url.startsWith("/notifications")
  ) {
    u += (u.includes("?") ? "&" : "?") + "owner=" + store.ownerId;
  }
  let res;
  try {
    res = await fetch(u, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Server non raggiungibile. Controlla che sia avviato.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/auth/login"))
      store.emit("session-expired", data.error);
    const err = new Error(data.error || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u, o) => request("GET", u, null, o),
  post: (u, b, o) => request("POST", u, b || {}, o),
  put: (u, b, o) => request("PUT", u, b || {}, o),
  del: (u, o) => request("DELETE", u, null, o),
};
