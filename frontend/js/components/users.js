// Gestione utenti (solo admin) e profilo personale.
import { h, dateIt, mount } from "../utils.js";
import { api } from "../api.js";
import { store } from "../store.js";
import {
  modal,
  confirmDialog,
  toast,
  field,
  input,
  select,
  formData,
  errorBox,
  loading,
  badge,
  kpi,
} from "./ui.js";
import { loadOwners, setOwner } from "./navbar.js";

const PW_HINT = "Almeno 8 caratteri con maiuscola, minuscola, numero e simbolo";
const ROLE_LABEL = {
  admin: "Amministratore",
  utente: "Utente",
  cliente: "Cliente",
};

export async function renderUsers(view, { onRelogin }) {
  loading(view);
  let users, clients;
  try {
    [users, clients] = await Promise.all([api.get("/users"), allClients()]);
  } catch (e) {
    mount(view, h("div", { class: "form-error" }, e.message));
    return;
  }
  const reload = async () => {
    await loadOwners();
    renderUsers(view, { onRelogin });
  };
  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Utenti"),
        h(
          "p",
          {},
          "Crea gli accessi: gli utenti vedono solo i propri dati, i clienti solo le proprie allocazioni",
        ),
      ),
      h("span", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => userForm(null, clients, reload, onRelogin),
        },
        "+ Nuovo utente",
      ),
    ),
    h(
      "div",
      { class: "grid kpis", style: { marginBottom: "16px" } },
      kpi(
        "Utenti totali",
        String(users.length),
        `${users.filter((u) => u.active).length} attivi · ${users.filter((u) => !u.active).length} disattivati`,
      ),
      kpi(
        "Amministratori",
        String(users.filter((u) => u.role === "admin").length),
        `${users.filter((u) => u.role === "admin" && u.active).length} attivi`,
      ),
      kpi(
        "Utenti",
        String(users.filter((u) => u.role === "utente").length),
        "gestiscono un portafoglio",
      ),
      kpi(
        "Clienti con accesso",
        String(users.filter((u) => u.role === "cliente").length),
        "sola lettura",
      ),
    ),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ["Utente", "Nome", "Ruolo", "Stato", "Creato", ""].map((x) =>
              h("th", {}, x),
            ),
          ),
        ),
        h(
          "tbody",
          {},
          users.map((u) =>
            h(
              "tr",
              {},
              h(
                "td",
                {},
                h("span", { class: "name" }, u.username),
                u.id === store.user.id &&
                  h("span", { class: "muted" }, " (tu)"),
              ),
              h(
                "td",
                {},
                u.name,
                u.clientName &&
                  h("div", { class: "sub" }, `cliente: ${u.clientName}`),
              ),
              h(
                "td",
                {},
                badge(
                  ROLE_LABEL[u.role],
                  u.role === "admin"
                    ? "info"
                    : u.role === "utente"
                      ? "success"
                      : "neutral",
                ),
                u.protected && " ",
                u.protected &&
                  badge(
                    "iniziale",
                    "warning",
                    "Admin creato al primo avvio: eliminabile se c'è almeno un altro admin attivo",
                  ),
              ),
              h(
                "td",
                {},
                u.active
                  ? badge("attivo", "success")
                  : badge("disattivato", "danger"),
              ),
              h("td", {}, dateIt((u.createdAt || "").slice(0, 10))),
              h(
                "td",
                {},
                h(
                  "div",
                  { class: "actions" },
                  u.active &&
                    u.id !== store.user.id &&
                    h(
                      "button",
                      {
                        class: "btn sm",
                        title:
                          "Entra nella sua piattaforma: vedi il portafoglio, compri e vendi per lui",
                        onclick: () => {
                          if (u.role === "cliente") {
                            location.hash = `#/as/${u.id}`;
                            return;
                          }
                          setOwner(u.id);
                          location.hash = "#/dashboard";
                        },
                      },
                      "Apri piattaforma",
                    ),
                  h(
                    "button",
                    {
                      class: "btn sm",
                      onclick: () =>
                        userForm(
                          u,
                          clients,
                          reload,
                          onRelogin,
                          users.some(
                            (x) =>
                              x.id !== u.id && x.role === "admin" && x.active,
                          ),
                        ),
                    },
                    "Modifica",
                  ),
                  (u.id !== store.user.id ||
                    (u.role === "admin" &&
                      users.some(
                        (x) => x.id !== u.id && x.role === "admin" && x.active,
                      ))) &&
                    h(
                      "button",
                      {
                        class: "btn sm danger",
                        "aria-label": "Elimina",
                        title:
                          u.id === store.user.id
                            ? "Elimina il tuo account (resta almeno un altro admin attivo)"
                            : "Elimina",
                        onclick: async () => {
                          const own = u.id === store.user.id;
                          if (
                            !(await confirmDialog(
                              own
                                ? "Eliminare il tuo account?"
                                : "Eliminare l'utente?",
                              own
                                ? `${u.username}: uscirai subito e dovrai accedere con un altro admin. Verranno eliminati anche portafoglio, clienti e operazioni che ti appartengono.`
                                : `${u.username}: verranno eliminati anche portafoglio, clienti e operazioni che gli appartengono.`,
                              { okLabel: "Elimina" },
                            ))
                          )
                            return;
                          try {
                            const r = await api.del(`/users/${u.id}`);
                            if (r && r.relogin) {
                              onRelogin(
                                "Il tuo account è stato eliminato: accedi con un altro amministratore.",
                              );
                              return;
                            }
                            toast("Utente eliminato", u.username, "success");
                            reload();
                          } catch (e) {
                            toast("Errore", e.message, "danger");
                          }
                        },
                      },
                      "🗑",
                    ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      "p",
      { class: "disclaimer" },
      "Puoi eliminare o disattivare qualsiasi amministratore (anche quello iniziale) finché ne resta almeno un altro attivo (puoi eliminare anche il tuo account di admin, non quello degli altri ruoli). Se cambi credenziali, ruolo o stato di un account, quell'utente esce subito da tutti i dispositivi.",
    ),
  );
}

// Elenco clienti di tutti i portafogli per il collegamento "utente cliente": uno per portafoglio
async function allClients() {
  const owners = await api.get("/users/owners");
  const out = [];
  for (const o of owners) {
    try {
      const l = await api.get(`/clients?owner=${o.id}`, { noOwner: true });
      l.forEach((c) =>
        out.push({ id: c.id, name: `${c.name} (portafoglio di ${o.name})` }),
      );
    } catch {
      /* ignora */
    }
  }
  return out;
}

function userForm(u, clients, onSaved, onRelogin, canSelfEdit = false) {
  const editing = !!u;
  const lockSelf = !!(u && u.id === store.user.id && !canSelfEdit); // il proprio ruolo/stato si cambia solo se resta un altro admin attivo
  const m = modal(editing ? `Modifica ${u.username}` : "Nuovo utente", {
    narrow: true,
  });
  const role = select(
    "role",
    Object.entries(ROLE_LABEL),
    u ? u.role : "utente",
    { disabled: lockSelf },
  );
  const clientSel = select(
    "clientId",
    [["", "— scegli cliente —"], ...clients.map((c) => [c.id, c.name])],
    u ? u.clientId || "" : "",
  );
  const clientField = field(
    "Cliente collegato",
    clientSel,
    "Il cliente vedrà solo le sue allocazioni",
  );
  const toggle = () =>
    clientField.classList.toggle("hidden", role.value !== "cliente");
  role.addEventListener("change", toggle);
  toggle();
  const active = h("input", {
    type: "checkbox",
    name: "active",
    checked: u ? u.active : true,
    disabled: lockSelf,
  });

  const form = h(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        const d = formData(form);
        const body = {
          username: d.username,
          name: d.name,
          role: lockSelf ? u.role : d.role,
          clientId: d.clientId || null,
          active: lockSelf ? true : active.checked,
        };
        if (d.password) body.password = d.password;
        try {
          if (editing) {
            const r = await api.put(`/users/${u.id}`, body);
            m.close();
            if (r.relogin) {
              toast("Account modificato", "Rifai il login", "warning");
              onRelogin("Hai modificato il tuo account: accedi di nuovo.");
              return;
            }
          } else {
            body.password = d.password;
            await api.post("/users", body);
            m.close();
          }
          toast("Utente salvato", d.username, "success");
          onSaved();
        } catch (ex) {
          err.show(ex.message);
        }
      },
    },
    field(
      "Nome utente",
      input("username", {
        required: true,
        value: u ? u.username : "",
        autocomplete: "off",
        maxlength: 32,
      }),
      "3-32 caratteri: lettere, numeri, . _ -",
    ),
    field(
      "Nome completo",
      input("name", { required: true, value: u ? u.name : "", maxlength: 100 }),
    ),
    field(
      editing ? "Nuova password (lascia vuoto per non cambiarla)" : "Password",
      input("password", {
        type: "password",
        autocomplete: "new-password",
        required: !editing,
      }),
      PW_HINT,
    ),
    field("Ruolo", role),
    clientField,
    h("label", { class: "checkbox" }, active, "Account attivo"),
    h(
      "div",
      { class: "modal-foot" },
      h(
        "button",
        { type: "button", class: "btn", onclick: () => m.close() },
        "Annulla",
      ),
      h("button", { class: "btn primary", type: "submit" }, "Salva"),
    ),
  );
  m.body.append(form);
  const err = errorBox(form);
}

// ---- Profilo personale -------------------------------------------------------------------------
export function renderProfile(view, { onRelogin }) {
  const u = store.user;
  const section = (title, desc, formEl) =>
    h(
      "section",
      { class: "card" },
      h("h2", {}, title),
      h("p", { class: "muted", style: { marginTop: 0 } }, desc),
      formEl,
    );

  const pwErr = h("div", { class: "form-error hidden", role: "alert" });
  const pwForm = h(
    "form",
    {
      class: "stack",
      style: { maxWidth: "380px" },
      onsubmit: async (e) => {
        e.preventDefault();
        pwErr.classList.add("hidden");
        const d = formData(pwForm);
        if (d.next !== d.again) {
          pwErr.textContent = "Le due nuove password non coincidono";
          pwErr.classList.remove("hidden");
          return;
        }
        try {
          await api.post("/auth/change-password", {
            current: d.current,
            next: d.next,
          });
          onRelogin("Password cambiata: accedi con la nuova password.");
        } catch (ex) {
          pwErr.textContent = ex.message;
          pwErr.classList.remove("hidden");
        }
      },
    },
    pwErr,
    field(
      "Password attuale",
      input("current", {
        type: "password",
        required: true,
        autocomplete: "current-password",
      }),
    ),
    field(
      "Nuova password",
      input("next", {
        type: "password",
        required: true,
        autocomplete: "new-password",
      }),
      PW_HINT,
    ),
    field(
      "Ripeti nuova password",
      input("again", {
        type: "password",
        required: true,
        autocomplete: "new-password",
      }),
    ),
    h(
      "div",
      {},
      h("button", { class: "btn primary", type: "submit" }, "Cambia password"),
    ),
  );

  const unErr = h("div", { class: "form-error hidden", role: "alert" });
  const unForm = h(
    "form",
    {
      class: "stack",
      style: { maxWidth: "380px" },
      onsubmit: async (e) => {
        e.preventDefault();
        unErr.classList.add("hidden");
        const d = formData(unForm);
        try {
          await api.post("/auth/change-username", {
            current: d.current,
            username: d.username,
          });
          onRelogin("Nome utente cambiato: accedi con il nuovo nome.");
        } catch (ex) {
          unErr.textContent = ex.message;
          unErr.classList.remove("hidden");
        }
      },
    },
    unErr,
    field(
      "Nuovo nome utente",
      input("username", { required: true, value: u.username, maxlength: 32 }),
    ),
    field(
      "Password attuale (conferma)",
      input("current", {
        type: "password",
        required: true,
        autocomplete: "current-password",
      }),
    ),
    h(
      "div",
      {},
      h(
        "button",
        { class: "btn primary", type: "submit" },
        "Cambia nome utente",
      ),
    ),
  );

  mount(
    view,
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        {},
        h("h1", {}, "Il mio account"),
        h("p", {}, `${u.name} · ${u.username} · ${ROLE_LABEL[u.role]}`),
      ),
    ),
    u.mustChangePassword &&
      h(
        "div",
        { class: "banner" },
        "⚠ Stai usando la password iniziale: cambiala subito.",
      ),
    h(
      "div",
      { class: "grid two" },
      section(
        "Password",
        "Dopo il cambio verrai disconnesso (anche dagli altri dispositivi).",
        pwForm,
      ),
      section(
        "Nome utente",
        "Dopo il cambio verrai disconnesso (anche dagli altri dispositivi).",
        unForm,
      ),
    ),
  );
}
