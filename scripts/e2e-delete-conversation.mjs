/**
 * Self-test E2E de comportamiento — 026: eliminar una conversación.
 *
 * Conduce la app real con los simuladores de canal y hace de CEREBRO: levanta
 * un servidor HTTP en `BRAIN_DISPATCH_URL`, en este proceso, para recibir el
 * aviso `conversation.deleted` y verificar su firma sobre el cuerpo crudo,
 * como debe hacerlo un cerebro de verdad.
 *
 * Uso:
 *   1) app corriendo (`next dev`) sobre una base migrada, con
 *      WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock, BOT_API_KEY y
 *      BRAIN_DISPATCH_URL=http://127.0.0.1:<puerto libre>/vocero/dispatch.
 *      Con AGENDA=on corre además la cita por venir (AC6).
 *   2) node --env-file=.env scripts/e2e-delete-conversation.mjs
 *
 * Dos modos, según cómo arrancó la app:
 *   - con BRAIN_DISPATCH_URL: todo, incluido el aviso al cerebro;
 *   - sin ella: el borrado y `agente: "no_aplica"` (no hay a quién avisar).
 * El gate completo son las dos corridas.
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-eliminar.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const DISPATCH = (process.env.BRAIN_DISPATCH_URL ?? "").trim();
const MEDIA_DIR = process.env.MEDIA_DIR ?? "";
const AGENDA = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const BRAND = `#${RUN}`;
const DIGITS = String(Date.now() % 1_000_000).padStart(6, "0");
const phone = (n) => `52155${DIGITS}${String(n).padStart(2, "0")}`;
const FORGET_KEYS = ["type", "eventId", "organization", "conversation", "contact", "deletedAt"];

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** `jar` aparte para actuar como otra persona sin perder la sesión del dueño. */
async function api(route, opts = {}, jar = null) {
  const actual = jar ? jar.cookie : cookie;
  const res = await fetch(`${BASE}${route}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(actual ? { cookie: actual } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const newOne = setCookie.map((c) => c.split(";")[0]).join("; ");
    if (jar) jar.cookie = newOne;
    else cookie = newOne;
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(cond, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// ---------------------------------------------------------------------------
// El cerebro de prueba
// ---------------------------------------------------------------------------

function signatureOk(raw, header) {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", BOT_KEY).update(raw).digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function startBrain(url) {
  const statusValue = { mode: "ok", received: [] };
  const server = createServer((req, res) => {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== url.pathname) {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let event = null;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {}
      statusValue.received.push({
        raw: raw.toString("utf8"),
        event: event,
        signatureOk: signatureOk(raw, req.headers["x-vocero-signature"]),
        headers: {
          dispatch: req.headers["x-vocero-dispatch-id"] ?? null,
          org: req.headers["x-vocero-organization"] ?? null,
          event: req.headers["x-vocero-event"] ?? null,
        },
      });
      const status = statusValue.mode === "500" ? 500 : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ status }));
    });
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(url.port || 80), url.hostname.replace(/^\[|\]$/g, ""), resolve);
    });
  await listen();
  return {
    state: statusValue,
    /** Los avisos de olvido de esa conversación. */
    forgets: (convId) =>
      statusValue.received.filter(
        (r) => r.event?.type === "conversation.deleted" && r.event?.conversation?.id === convId
      ),
    /** Los turnos (despachos) de esa conversación. */
    turns: (convId) =>
      statusValue.received.filter((r) => !r.event?.type && r.event?.conversation?.id === convId),
    turnOff: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    turnOn: listen,
  };
}

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

let nMessage = 0;
const inboundWa = (from, name, text, extra = {}) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.eliminar.${RUN}.${++nMessage}`,
      ...extra,
    }),
  });

const conversations = async () => (await api("/api/conversations")).json?.conversations ?? [];
const convDe = (name) =>
  until(async () => (await conversations()).find((c) => c.contact.name === name && c.lastInboundAt));
const messages = (id) => api(`/api/conversations/${id}/messages`);
const contact = (id) => api(`/api/contacts/${id}`);
const deleteIt = (id, { contact: also = false } = {}, jar = null) =>
  api(`/api/conversations/${id}${also ? "?contacto=1" : ""}`, { method: "DELETE" }, jar);

/** Una persona nueva escribe; devuelve su conversación ya ingerida. */
async function persona(n, label) {
  const tel = phone(n);
  const nameValue = `Borrar ${label} ${BRAND}`;
  await inboundWa(tel, nameValue, `hola, soy ${label} ${BRAND}`);
  return { tel, name: nameValue, conv: await convDe(nameValue) };
}

/** ¿Hay en el volumen un archivo con ese id de adjunto, en cualquier organización? */
function fileOnDisk(assetId) {
  if (!MEDIA_DIR || !existsSync(MEDIA_DIR)) return null;
  return readdirSync(MEDIA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .some((d) => existsSync(path.join(MEDIA_DIR, d.name, assetId)));
}

/** Escucha el SSE de la bandeja con la sesión actual hasta que `cuando` diga basta. */
function listenEvents() {
  const controller = new AbortController();
  const seen = [];
  const ready = (async () => {
    const res = await fetch(`${BASE}/api/events`, {
      headers: { cookie, accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const kind = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (kind && data) {
          try {
            seen.push({ type: kind, data: JSON.parse(data) });
          } catch {}
        }
      }
    }
  })().catch(() => {});
  return { vistos: seen, close: () => (controller.abort(), ready) };
}

// ---------------------------------------------------------------------------

async function main() {
  const withBrain = Boolean(DISPATCH);
  if (withBrain && !BOT_KEY) {
    console.error("Con BRAIN_DISPATCH_URL hace falta BOT_API_KEY: con ella se firma el aviso.");
    process.exit(1);
  }
  console.log(`== Setup (${withBrain ? "con cerebro por despacho" : "sin despacho"}${AGENDA ? ", agenda encendida" : ""}) ==`);
  const brain = withBrain ? await startBrain(new URL(DISPATCH)) : null;

  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("conexión de WhatsApp guardada (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  // El agente incluido, apagado: aquí no se prueba quién contesta.
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: false }) });

  try {
    await permissions();
    await theThread(brain);
    await theContact(brain);
    if (brain) await brainDown(brain);
    await upcomingBooking();
  } finally {
    if (brain) await brain.turnOff().catch(() => {});
  }

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// AC5 — Quién puede
// ---------------------------------------------------------------------------

async function permissions() {
  console.log("\n== AC5: solo quien administra, y solo lo que existe ==");
  const p = await persona(1, "permisos");
  ok("hay una conversación que cuidar", Boolean(p.conv));

  const emailValue = `equipo-${RUN}@vocero.test`;
  const key = "password-equipo-123";
  const high = await api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "Equipo E2E", email: emailValue, password: key }),
  });
  const jar = { cookie: "" };
  const enters = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: emailValue, password: key }) }, jar);
  ok("una persona del equipo inicia sesión", high.res.status === 201 && enters.res.ok, `${high.res.status} ${enters.res.status}`);

  const fromMember = await deleteIt(p.conv.id, {}, jar);
  ok("un miembro del equipo → 403", fromMember.res.status === 403 && fromMember.json?.error?.code === "forbidden", `${fromMember.res.status} ${JSON.stringify(fromMember.json)}`);
  const withEverything = await deleteIt(p.conv.id, { contact: true }, jar);
  ok("tampoco con el contacto → 403", withEverything.res.status === 403, String(withEverything.res.status));
  const missingOne = await deleteIt("cv_no_existe_0000000000");
  ok("una conversación que no existe → 404", missingOne.res.status === 404, String(missingOne.res.status));
  ok(
    "y la conversación sigue en la bandeja, con su mensaje",
    (await conversations()).some((c) => c.id === p.conv.id) &&
      ((await messages(p.conv.id)).json?.messages ?? []).length === 1
  );
}

// ---------------------------------------------------------------------------
// AC1, AC2, AC3, AC7, AC9, AC10 — El hilo
// ---------------------------------------------------------------------------

async function theThread(brain) {
  console.log("\n== AC1–AC3: eliminar el hilo ==");
  const p = await persona(2, "hilo");
  // Un adjunto, para comprobar que se va de verdad.
  await inboundWa(p.tel, p.name, undefined, { type: "image", mediaId: "media123", mimeType: "image/jpeg", caption: `foto ${BRAND}` });
  const withPhoto = await until(async () => {
    const ms = (await messages(p.conv.id)).json?.messages ?? [];
    return ms.find((m) => m.media?.assetId) ?? null;
  });
  ok("la conversación tiene un adjunto", Boolean(withPhoto), "no llegó el mensaje con imagen");
  const assetId = withPhoto?.media?.assetId;
  const before = assetId ? await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie } }) : null;
  ok("el adjunto se puede abrir antes de borrar", before?.status === 200, String(before?.status));
  const onDiskBefore = assetId ? fileOnDisk(assetId) : null;
  if (onDiskBefore !== null) ok("y su archivo está en el volumen", onDiskBefore === true);

  const contactId = p.conv.contact.id;
  await api(`/api/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: `nota que se queda ${BRAND}`, ficha: { interes: "taladro", presupuesto: 1500 } }),
  });
  const cBefore = (await contact(contactId)).json;
  ok(
    "el contacto tiene notas, ficha y etapa",
    cBefore?.contact?.notes?.includes(BRAND) && cBefore?.contact?.ficha?.interes === "taladro" && Boolean(cBefore?.stage?.id),
    JSON.stringify({ n: cBefore?.contact?.notes, f: cBefore?.contact?.ficha, s: cBefore?.stage })
  );
  if (brain) {
    ok("(con despacho) el cerebro ya recibió turnos de esta conversación", Boolean(await until(() => brain.turns(p.conv.id).length > 0)));
  }

  const sse = listenEvents();
  await sleep(600);
  const r = await deleteIt(p.conv.id);
  ok(
    `DELETE → 200 con alcance «hilo» y agente «${brain ? "avisado" : "no_aplica"}»`,
    r.res.status === 200 && r.json?.ok === true && r.json?.scope === "hilo" && r.json?.agent === (brain ? "avisado" : "no_aplica"),
    `${r.res.status} ${JSON.stringify(r.json)}`
  );
  ok("ya no sale en la bandeja", !(await conversations()).some((c) => c.id === p.conv.id));
  const ms = await messages(p.conv.id);
  ok("sus mensajes ya no existen", ms.res.status === 404 || (ms.json?.messages ?? []).length === 0, `${ms.res.status} ${JSON.stringify(ms.json).slice(0, 120)}`);

  console.log("\n== AC2: el contacto se queda ==");
  const cAfter = (await contact(contactId)).json;
  ok("el contacto sigue en Contactos, con su nota", cAfter?.contact?.notes?.includes(BRAND) === true, JSON.stringify(cAfter?.contact?.notes));
  ok("en la misma etapa del pipeline", cAfter?.stage?.id === cBefore?.stage?.id && cAfter?.lead?.id === cBefore?.lead?.id, JSON.stringify(cAfter?.stage));
  ok("y con la ficha vacía", JSON.stringify(cAfter?.contact?.ficha ?? null) === "{}", JSON.stringify(cAfter?.contact?.ficha));

  console.log("\n== AC3: el adjunto se fue de verdad ==");
  const after = assetId ? await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie } }) : null;
  ok("el adjunto responde 404", after?.status === 404, String(after?.status));
  if (onDiskBefore !== null) ok("y su archivo ya no está en el volumen", fileOnDisk(assetId) === false);

  console.log("\n== AC10: la bandeja se entera sola ==");
  const notice = await until(() => sse.vistos.find((e) => e.type === "conversation.deleted" && e.data?.conversationId === p.conv.id), 5000);
  await sse.close();
  ok(
    "llega conversation.deleted por el SSE, sin contenido",
    notice?.data?.contactId === contactId && notice?.data?.contactDeleted === false && Object.keys(notice.data).length === 3,
    JSON.stringify(notice)
  );

  if (brain) {
    console.log("\n== AC7: el cerebro recibe el aviso ==");
    const forgets = brain.forgets(p.conv.id);
    const o = forgets[0];
    ok("llegó exactamente un conversation.deleted", forgets.length === 1, `llegaron ${forgets.length}`);
    ok("firmado como un turno, sobre el cuerpo crudo", o?.signatureOk === true);
    ok(
      "con x-vocero-event, con la organización y SIN id de despacho",
      o?.headers.event === "conversation.deleted" && Boolean(o?.headers.org) && o?.headers.dispatch === null,
      JSON.stringify(o?.headers)
    );
    ok("las claves, en el orden del contrato", JSON.stringify(Object.keys(o?.event ?? {})) === JSON.stringify(FORGET_KEYS), JSON.stringify(Object.keys(o?.event ?? {})));
    const e = o?.event ?? {};
    ok(
      "dice qué conversación, por qué canal y de quién",
      e.conversation?.id === p.conv.id && e.conversation?.channel === "whatsapp" && e.contact?.id === contactId && String(e.contact?.identity ?? "").endsWith(p.tel.slice(-10)),
      JSON.stringify({ c: e.conversation, ct: e.contact })
    );
    ok(
      "con un id de evento propio y la hora del borrado",
      /^olv_[0-9a-z]{20}$/.test(e.eventId ?? "") && Math.abs(Date.now() - Date.parse(e.deletedAt)) < 60_000,
      JSON.stringify({ id: e.eventId, at: e.deletedAt })
    );
    ok("y no lleva nada de lo borrado", !o?.raw.includes(BRAND) && !o?.raw.includes("taladro"), "");
  }

  const other = await deleteIt(p.conv.id);
  ok("eliminarla otra vez → 404", other.res.status === 404, String(other.res.status));

  console.log("\n== AC9: si vuelve a escribir, es una conversación nueva ==");
  await inboundWa(p.tel, p.name, `ya volví ${BRAND}`);
  const newOne = await until(async () => (await conversations()).find((c) => c.contact.id === contactId && c.lastInboundAt));
  ok("del mismo contacto, con otro id", Boolean(newOne) && newOne.id !== p.conv.id, JSON.stringify(newOne?.id));
  ok("y sin historial: solo el mensaje nuevo", ((await messages(newOne.id)).json?.messages ?? []).length === 1);
  if (brain) {
    const turn = await until(() => brain.turns(newOne.id)[0]);
    ok(
      "al cerebro le llega como una conversación nueva (otro conversation.id, la misma identidad)",
      Boolean(turn) && turn.event.messages.length === 1 && turn.event.contact.id === contactId,
      JSON.stringify(turn?.event?.messages?.length)
    );
  }
}

// ---------------------------------------------------------------------------
// AC4 — El contacto
// ---------------------------------------------------------------------------

async function theContact(brain) {
  console.log("\n== AC4: eliminar también el contacto ==");
  const p = await persona(3, "contacto");
  const contactId = p.conv.contact.id;
  const leadBefore = (await contact(contactId)).json?.lead?.id;
  ok("la persona tiene contacto y lead", Boolean(leadBefore));

  const r = await deleteIt(p.conv.id, { contact: true });
  ok(
    "DELETE ?contacto=1 → 200 con alcance «contacto»",
    r.res.status === 200 && r.json?.scope === "contacto" && r.json?.agent === (brain ? "avisado" : "no_aplica"),
    `${r.res.status} ${JSON.stringify(r.json)}`
  );
  ok("la conversación ya no sale en la bandeja", !(await conversations()).some((c) => c.id === p.conv.id));
  ok("el contacto ya no existe → 404", (await contact(contactId)).res.status === 404);
  const list = (await api(`/api/contacts?q=${encodeURIComponent(p.name)}`)).json?.contacts ?? [];
  ok("ni sale en Contactos", !list.some((c) => c.id === contactId), JSON.stringify(list.map((c) => c.id)));
  const board = JSON.stringify((await api("/api/pipeline/board")).json ?? {});
  ok("ni en el Pipeline", !board.includes(contactId) && !board.includes(leadBefore));
  if (brain) ok("el cerebro recibió su aviso", brain.forgets(p.conv.id).length === 1);

  await inboundWa(p.tel, p.name, `soy nuevo otra vez ${BRAND}`);
  const newOne = await convDe(p.name);
  ok("si vuelve a escribir es una persona nueva: otro contacto y otra conversación", Boolean(newOne) && newOne.contact.id !== contactId && newOne.id !== p.conv.id);
}

// ---------------------------------------------------------------------------
// AC8 — El cerebro no confirma
// ---------------------------------------------------------------------------

async function brainDown(brain) {
  console.log("\n== AC8: el borrado no depende del cerebro ==");
  const a = await persona(4, "cerebro500");
  await until(() => brain.turns(a.conv.id).length > 0);
  brain.state.mode = "500";
  const r500 = await deleteIt(a.conv.id);
  ok("el cerebro contesta 500 → se elimina igual, con agente «sin_confirmar»", r500.res.status === 200 && r500.json?.agent === "sin_confirmar", `${r500.res.status} ${JSON.stringify(r500.json)}`);
  ok("ya no sale en la bandeja", !(await conversations()).some((c) => c.id === a.conv.id));
  await sleep(2500);
  ok("y no se reintenta: un solo aviso", brain.forgets(a.conv.id).length === 1, `llegaron ${brain.forgets(a.conv.id).length}`);
  brain.state.mode = "ok";

  const b = await persona(5, "cerebroapagado");
  await until(() => brain.turns(b.conv.id).length > 0);
  await brain.turnOff();
  const t0 = Date.now();
  const rOff = await deleteIt(b.conv.id);
  const tookLong = Date.now() - t0;
  await brain.turnOn();
  ok("con el cerebro apagado → se elimina igual, «sin_confirmar»", rOff.res.status === 200 && rOff.json?.agent === "sin_confirmar", `${rOff.res.status} ${JSON.stringify(rOff.json)}`);
  ok("sin hacer esperar a quien elimina (menos de 10 s)", tookLong < 10_000, `${tookLong} ms`);
  ok("ya no sale en la bandeja", !(await conversations()).some((c) => c.id === b.conv.id));
}

// ---------------------------------------------------------------------------
// AC6 — Una cita por venir
// ---------------------------------------------------------------------------

async function upcomingBooking() {
  console.log("\n== AC6: una cita por venir detiene el borrado ==");
  if (!AGENDA) {
    console.log("  SKIP: la app corre sin AGENDA=on");
    return;
  }
  const everyone = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "23:30" }]]));
  const conf = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ weeklyHours: everyone, slotMinutes: 30, minNoticeHours: 0, maxDaysAhead: 7, connector: "enlace-fijo", meetingLink: "https://meet.ejemplo.test/sala" }),
  });
  ok("agenda configurada", conf.res.ok, `${conf.res.status} ${JSON.stringify(conf.json).slice(0, 160)}`);
  const slots = (await api("/api/calendar/availability")).json?.slots ?? [];
  const slot = slots.at(-1);
  const startUtc = slot?.startUtc ?? slot?.start ?? slot?.startsAt;
  ok("hay un hueco para agendar", Boolean(startUtc), JSON.stringify(slot));
  if (!startUtc) return;

  const p = await persona(6, "cita");
  const contactId = p.conv.contact.id;
  const booking = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ kind: "session", contactId, conversationId: p.conv.id, startUtc }),
  });
  const bookingId = booking.json?.booking?.id ?? booking.json?.id;
  ok("la persona tiene una cita agendada por venir", booking.res.status === 201 && Boolean(bookingId), `${booking.res.status} ${JSON.stringify(booking.json).slice(0, 200)}`);

  for (const [nameValue, opts] of [["el hilo", {}], ["el contacto", { contact: true }]]) {
    const r = await deleteIt(p.conv.id, opts);
    ok(
      `eliminar ${nameValue} → 409 cita_pendiente que dice la fecha y manda a Citas`,
      r.res.status === 409 && r.json?.error?.code === "cita_pendiente" && /\d{4}/.test(r.json?.error?.message ?? "") && r.json?.error?.message?.includes("Citas"),
      `${r.res.status} ${JSON.stringify(r.json)}`
    );
  }
  ok("no se borró nada", (await conversations()).some((c) => c.id === p.conv.id) && (await contact(contactId)).res.status === 200);

  const cancel = await api(`/api/bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) });
  ok("se cancela la cita", cancel.res.ok, `${cancel.res.status} ${JSON.stringify(cancel.json).slice(0, 160)}`);
  const r = await deleteIt(p.conv.id);
  ok("con la cita cancelada → se elimina", r.res.status === 200, `${r.res.status} ${JSON.stringify(r.json)}`);
  const bookings = JSON.stringify((await api("/api/bookings")).json ?? {});
  ok("la cita cancelada se queda en el historial del contacto, sin conversación", bookings.includes(bookingId) && (await contact(contactId)).res.status === 200, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
