/**
 * Self-test E2E de comportamiento — bitácora de movimientos de etapa
 * (guion tests/e2e/us2-pipeline.md, sección "bitácora").
 *
 * Conduce la app por HTTP y verifica la tabla `lead_stage_event` directo en la
 * base: todavía no hay endpoint que la exponga (llega con la analítica), y lo
 * que este PR promete es justamente que NINGÚN camino mueva un lead sin dejar
 * su renglón.
 *
 * Uso: node --env-file=.env scripts/e2e-stage-history.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-BIT-1";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
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

// TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
});
const eventsOf = (leadId) =>
  sql`select * from lead_stage_event where lead_id = ${leadId} order by occurred_at asc, created_at asc`;

console.log("== Setup ==");
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

const conn = await api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: "WABA-BIT", phoneNumberId: PN, token: "tok-bit" }),
});
ok("conexión WhatsApp guardada", conn.res.ok);

console.log("\n== El lead nace con su evento ==");
const NAME = `Prospecto${S}`;
await api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({
    phoneNumberId: PN,
    from: `52155600${Math.floor(1000 + Math.random() * 8999)}`,
    name: NAME,
    text: "hola, me interesa",
  }),
});
let lead = null;
await until(async () => {
  const board = (await api("/api/pipeline/board")).json;
  lead = (board?.leads ?? []).find((l) => l.contact.name === NAME);
  return Boolean(lead);
});
ok("el lead se creó al entrar el mensaje", Boolean(lead));

let events = await eventsOf(lead.id);
ok(
  "quedó su evento de nacimiento",
  events.length === 1 && events[0].from_stage_id === null,
  JSON.stringify(events.map((e) => e.to_stage_name))
);
ok(
  "y NO viene marcado como aproximado (pasó de verdad)",
  events[0]?.approximate === false
);

console.log("\n== Mover una tarjeta deja su renglón ==");
const board = (await api("/api/pipeline/board")).json;
const isOpen = board.stages.find(
  (s) => s.kind === "open" && s.id !== lead.stageId
);
const mov = await api(`/api/pipeline/leads/${lead.id}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: isOpen.id, position: 0 }),
});
ok("el PATCH del tablero responde 200", mov.res.ok, JSON.stringify(mov.json));
events = await eventsOf(lead.id);
ok(
  "la bitácora tiene DOS eventos y el segundo trae de dónde venía",
  events.length === 2 && events[1].from_stage_id !== null,
  JSON.stringify(events.map((e) => `${e.from_stage_name ?? "—"}→${e.to_stage_name}`))
);
ok(
  "y guarda quién lo movió y por qué camino",
  events[1].source === "dueno" && events[1].actor_user_id !== null,
  JSON.stringify({ source: events[1].source, actor: events[1].actor_user_id })
);

console.log("\n== Reordenar en la MISMA etapa no inventa un movimiento ==");
await api(`/api/pipeline/leads/${lead.id}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: isOpen.id, position: 3 }),
});
events = await eventsOf(lead.id);
ok("siguen siendo dos eventos", events.length === 2, `hay ${events.length}`);

console.log("\n== Perder un trato exige motivo ==");
const lost = board.stages.find((s) => s.kind === "lost");
const withoutReason = await api(`/api/pipeline/leads/${lead.id}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: lost.id, position: 0 }),
});
ok(
  "sin motivo → 422 loss_reason_required",
  withoutReason.res.status === 422 &&
    withoutReason.json?.error?.code === "loss_reason_required",
  JSON.stringify(withoutReason.json)
);
const board2 = (await api("/api/pipeline/board")).json;
const unchanged = board2.leads.find((l) => l.id === lead.id);
ok(
  "y la tarjeta NO se movió: el rechazo no deja el tablero a medias",
  unchanged?.stageId === isOpen.id,
  `quedó en ${unchanged?.stageId}`
);

const withReason = await api(`/api/pipeline/leads/${lead.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    stageId: lost.id,
    position: 0,
    lossReason: "precio",
    lossNote: "Se fue con una cotización más barata",
  }),
});
ok("con motivo → 200", withReason.res.ok, JSON.stringify(withReason.json));
events = await eventsOf(lead.id);
const last = events.at(-1);
ok(
  "el motivo y la nota quedan en la bitácora",
  last.loss_reason === "precio" &&
    last.loss_note?.includes("más barata") &&
    last.to_stage_kind === "lost",
  JSON.stringify({ reason: last.loss_reason, kind: last.to_stage_kind })
);

console.log("\n== La base tampoco lo permite (no depende de la ruta) ==");
let rejectedByBase = false;
try {
  await sql`
    insert into lead_stage_event (id, organization_id, lead_id, contact_id,
      to_stage_name, to_stage_kind, source, approximate)
    values (${"lse_probe_" + S}, ${last.organization_id}, ${lead.id},
      ${last.contact_id}, 'Perdido', 'lost', 'dueno', false)`;
} catch (err) {
  rejectedByBase = String(err).includes("lse_loss_reason_ck");
}
ok(
  "un INSERT directo de 'perdido' sin motivo lo rechaza el CHECK",
  rejectedByBase
);

console.log("\n== El bot también pasa por la puerta ==");
const convs = (await api("/api/conversations")).json?.conversations ?? [];
const conv = convs.find((c) => c.contact.name === NAME);
const reset = await api("/api/bot/reset", {
  method: "POST",
  headers: { "x-api-key": process.env.BOT_API_KEY ?? "" },
  body: JSON.stringify({ conversationId: conv.id }),
});
ok("POST /api/bot/reset → 200", reset.res.ok);
await sleep(400);
events = await eventsOf(lead.id);
ok(
  "el regreso al inicio quedó registrado como 'sistema'",
  events.at(-1).source === "sistema",
  JSON.stringify(events.map((e) => e.source))
);

console.log("\n== Borrar una etapa registra un evento por lead ==");
const newOne = await api("/api/pipeline/stages", {
  method: "POST",
  body: JSON.stringify({ name: `Temporal ${S}` }),
});
const stageTemp = newOne.json?.stage;
ok("etapa temporal creada", Boolean(stageTemp), JSON.stringify(newOne.json));
await api(`/api/pipeline/leads/${lead.id}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: stageTemp.id, position: 0 }),
});
const beforeDeleting = (await eventsOf(lead.id)).length;
const destination = board.stages.find((s) => s.kind === "open");
const deleted = await api(
  `/api/pipeline/stages/${stageTemp.id}?moveTo=${destination.id}`,
  { method: "DELETE" }
);
ok("etapa borrada con reubicación", deleted.res.ok, JSON.stringify(deleted.json));
events = await eventsOf(lead.id);
ok(
  "la reubicación dejó su propio evento",
  events.length === beforeDeleting + 1 && events.at(-1).source === "sistema",
  `antes ${beforeDeleting}, ahora ${events.length}`
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
