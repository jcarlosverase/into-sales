/**
 * Self-test E2E de comportamiento — ficha del lead
 * (guion tests/e2e/us1-inbox.md, sección "ficha").
 *
 * Lo que se prueba de verdad es la CONVIVENCIA: el agente va llenando la ficha
 * mientras el dueño la corrige. Con reemplazo en vez de merge, el último en
 * guardar le borra el trabajo al otro y nadie se entera hasta que falta un
 * dato en una llamada.
 *
 * Uso: node --env-file=.env scripts/e2e-qualification.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;
const PN = "PN-FICHA-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

let cookie = "";
let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

/** Llamada del cerebro externo: va con la API key, sin sesión. */
const bot = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-api-key": BOT_KEY },
    body: JSON.stringify(body),
  }).then(async (r) => ({ res: r, json: await r.json().catch(() => null) }));

const qualificationOf = async (contactId) =>
  (await api(`/api/contacts/${contactId}`)).json?.contact?.ficha;

console.log("== Setup ==");
if (!BOT_KEY) {
  console.log("  ✗ falta BOT_API_KEY en el entorno");
  process.exit(1);
}
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email, password, name: "Operador E2E" }),
});
if (!su.res.ok) {
  su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
ok("registro o login del operador", su.res.ok);
await api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: "WABA-FI", phoneNumberId: PN, token: "tok-fi" }),
});

// Un entrante crea contacto + conversación, que es lo que el bot necesita.
const phone = `52155000${Math.floor(1000 + Math.random() * 8999)}`;
await api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN, from: phone, name: `Ficha${S}`, text: "hola" }),
});
await new Promise((r) => setTimeout(r, 1200));
const convs = (await api("/api/conversations")).json?.conversations ?? [];
const conv = convs.find((c) => c.contact?.name === `Ficha${S}`);
ok("conversación de prueba creada", Boolean(conv), JSON.stringify(convs.length));
const contactId = conv?.contact?.id;

console.log("\n== Nace vacía, no ausente ==");
const initial = await qualificationOf(contactId);
ok(
  "un contacto nuevo trae ficha vacía, no undefined",
  initial && typeof initial === "object" && Object.keys(initial).length === 0,
  JSON.stringify(initial)
);

console.log("\n== El agente la llena y el dueño la ve ==");
const written = await bot("/api/bot/qualification", {
  conversationId: conv.id,
  ficha: { presupuesto: 50000, zona: "Roma", calificado: true },
});
ok("PUT /api/bot/qualification → 200", written.res.ok, JSON.stringify(written.json));
const view = await qualificationOf(contactId);
ok(
  "lo que guardó el agente llega a la pantalla del dueño",
  view?.presupuesto === 50000 && view?.zona === "Roma" && view?.calificado === true,
  JSON.stringify(view)
);

console.log("\n== El dueño corrige sin cambiar el tipo ==");
await api(`/api/contacts/${contactId}`, {
  method: "PATCH",
  body: JSON.stringify({ ficha: { presupuesto: 60000 } }),
});
const corrected = await qualificationOf(contactId);
ok(
  "el valor corregido queda, y sigue siendo número",
  corrected?.presupuesto === 60000,
  JSON.stringify(corrected?.presupuesto)
);
ok(
  "corregir una clave NO borra las demás",
  corrected?.zona === "Roma" && corrected?.calificado === true
);

console.log("\n== Nadie le pisa el trabajo al otro ==");
// El agente sigue conversando y descubre algo nuevo mientras el dueño edita.
await bot("/api/bot/qualification", {
  conversationId: conv.id,
  ficha: { urgencia: "esta semana" },
});
const convive = await qualificationOf(contactId);
ok(
  "lo nuevo del agente entra sin borrar la corrección del dueño",
  convive?.urgencia === "esta semana" && convive?.presupuesto === 60000,
  JSON.stringify(convive)
);

console.log("\n== Se puede quitar un dato equivocado ==");
await api(`/api/contacts/${contactId}`, {
  method: "PATCH",
  body: JSON.stringify({ ficha: { zona: null } }),
});
const withoutZone = await qualificationOf(contactId);
ok("null quita la clave", !("zona" in (withoutZone ?? {})), JSON.stringify(withoutZone));
ok("y no se lleva a las vecinas", withoutZone?.presupuesto === 60000);

console.log("\n== La cadena vacía NO borra ==");
await api(`/api/contacts/${contactId}`, {
  method: "PATCH",
  body: JSON.stringify({ ficha: { urgencia: "" } }),
});
const after = await qualificationOf(contactId);
ok(
  "vaciar sin querer no se lleva un dato que costó una conversación",
  after?.urgencia === "esta semana",
  JSON.stringify(after?.urgencia)
);

console.log("\n== Camino infeliz ==");
await api(`/api/contacts/${contactId}`, {
  method: "PATCH",
  body: JSON.stringify({ ficha: { anidado: { no: "se guarda" }, lista: [1, 2] } }),
});
const clean = await qualificationOf(contactId);
ok(
  "objetos y arreglos se ignoran en silencio, sin tirar la ficha",
  !("anidado" in clean) && !("lista" in clean) && clean?.presupuesto === 60000,
  JSON.stringify(clean)
);

const foreign = await api("/api/contacts/ct_inexistente_999", {
  method: "PATCH",
  body: JSON.stringify({ ficha: { x: "y" } }),
});
// Ojo con lo que este check NO prueba: un id inexistente da 404 aunque la
// query no filtre por organización. El aislamiento entre inquilinos lo cuida
// `tests/unit/qualification-guard.test.ts`, que sí se pone rojo si alguien quita el
// `scoped` de la puerta.
ok(
  "un contacto que no existe → 404, no una escritura a ciegas",
  foreign.res.status === 404,
  String(foreign.res.status)
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
