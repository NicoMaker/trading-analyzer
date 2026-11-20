// Notifiche: campanella, elenco e avvisi a schermo in diretta (socket.io).
import { h, dateTime } from "../utils.js";
import { api } from "../api.js";
import { store } from "../store.js";
import { modal, toast, badge } from "./ui.js";

let started = false;

export function updateBell() {
  const el = document.getElementById("notif-count");
  if (!el) return;
  el.textContent = store.unread > 99 ? "99+" : store.unread;
  el.classList.toggle("hidden", !store.unread);
}

export async function refreshUnread() {
  try {
    const r = await api.get("/notifications");
    store.unread = r.unread;
    updateBell();
    return r;
  } catch {
    return null;
  }
}

// Da chiamare una volta sola: ogni notifica che arriva in diretta compare come avviso e aggiorna la campanella
export function initNotifications() {
  if (started) return;
  started = true;
  store.on("notification", (n) => {
    store.unread += 1;
    updateBell();
    toast(
      n.title,
      n.message,
      n.severity === "danger"
        ? "danger"
        : n.severity === "success"
          ? "success"
          : n.severity === "warning"
            ? "warning"
            : "info",
      n.severity === "danger" ? 12000 : 8000,
    );
  });
}

export async function openNotifications() {
  const m = modal("Notifiche", { narrow: true });
  m.body.append(h("div", { class: "muted pad" }, "Caricamento…"));
  const r = await refreshUnread();
  if (!r) {
    m.body.replaceChildren(
      h("div", { class: "form-error" }, "Notifiche non disponibili"),
    );
    return;
  }
  const hadUnread = r.unread;
  m.body.replaceChildren(
    h(
      "div",
      { class: "stack", style: { gap: "8px" } },
      r.items.length
        ? r.items.map((n) =>
            h(
              "div",
              { class: `notif ${n.severity}${n.read ? "" : " unread"}` },
              h(
                "div",
                {},
                h("div", { class: "t" }, n.title),
                n.message && h("div", { class: "muted" }, n.message),
                h(
                  "div",
                  { class: "muted", style: { fontSize: "11.5px" } },
                  dateTime(
                    Date.parse(String(n.createdAt).replace(" ", "T") + "Z"),
                  ),
                ),
              ),
            ),
          )
        : [h("div", { class: "empty" }, "Nessuna notifica")],
    ),
  );
  if (hadUnread) {
    await api.post("/notifications/read-all").catch(() => {});
    store.unread = 0;
    updateBell();
  }
}
