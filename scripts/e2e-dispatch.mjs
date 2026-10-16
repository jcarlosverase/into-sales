/**
 * Self-test E2E de comportamiento — 021: despacho estándar (#89) y 025: el
 * despacho recuerda qué debe.
 *
 * Conduce la app real con los mocks de canal y hace de CEREBRO: levanta un
 * servidor HTTP en `BRAIN_DISPATCH_URL`, en este proceso (otro distinto del
 * CRM), recibe los despachos, verifica la firma sobre el cuerpo crudo como
 * debe hacerlo un cerebro de verdad y contesta por `/api/bot/messages`. Así el
 * turno cruza HTTP de verdad en las dos direcciones.
 *
 * Uso:
 *   1) app corriendo (`next dev`) sobre una base migrada, con
 *      WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      OPENROUTER_BASE_URL → ai-mock + OPENROUTER_API_TOKEN + OPENROUTER_MODEL,
 *      BOT_API_KEY, AGENT_COALESCE_MS corta (1500) y
 *      BRAIN_DISPATCH_URL=http://127.0.0.1:<puerto libre>/vocero/dispatch.
 *      Con CHANNELS=whatsapp,instagram,messenger,tiktok corre también esos
 *      canales (Instagram y TikTok entran por Zernio: ZERNIO_BASE_URL →
 *      zernio-mock).
 *   2) node --env-file=.env scripts/e2e-dispatch.mjs
 *
 * Dos modos, según cómo arrancó la app (025):
 *   - con BRAIN_DISPATCH_URL: todo lo de arriba, el guion del cerebro;
 *   - sin ella: contesta el agente incluido, y se comprueba lo que le toca a
 *     él (un mensaje que entra mientras el modelo piensa; una persona que
 *     contesta dentro de la ventana). No hace falta BOT_API_KEY.
 * El gate completo son las dos corridas.
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-despacho.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((c) => c.trim());
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
/** Marca de esta corrida: el arnés se puede repetir sobre la misma base. */
const BRAND = `#${RUN}`;
/** Seis dígitos de la corrida, para teléfonos que no choquen entre corridas. */
const DIGITS = String(Date.now() % 1_000_000).padStart(6, "0");
const phone = (n) => `52155${DIGITS}${String(n).padStart(2, "0")}`;

const EVENT_KEYS = [
  "dispatchId",
  "organization",
  "conversation",
  "contact",
  "messages",
  "firstMessageAt",
  "lastMessageAt",
];

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
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const bot = (path, opts = {}) =>
  api(path, { ...opts, headers: { "x-api-key": BOT_KEY, ...(opts.headers ?? {}) } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que algo OCURRA, en vez de dormir un rato y confiar. */
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
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", BOT_KEY).update(raw).digest("hex")}`
  );
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function startBrain(url) {
  const statusValue = {
    /** "ok" | "500" | "422" | "lento" */
    mode: "ok",
    slowMs: 3000,
    received: [],
  };
  const server = createServer((req, res) => {
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== url.pathname) {
      res.writeHead(404);
      return res.end();
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      // El cuerpo CRUDO, antes de parsear: es sobre esto que se firma.
      const raw = Buffer.concat(chunks);
      let event = null;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {}
      statusValue.received.push({
        at: Date.now(),
        mode: statusValue.mode,
        raw: raw.toString("utf8"),
        event: event,
        signatureOk: signatureOk(raw, req.headers["x-vocero-signature"]),
        headers: {
          dispatch: req.headers["x-vocero-dispatch-id"] ?? null,
          org: req.headers["x-vocero-organization"] ?? null,
          event: req.headers["x-vocero-event"] ?? null,
          kind: req.headers["content-type"] ?? null,
        },
      });
      const respond = (status) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(status < 300 ? { status: "ok" } : { error: "simulado" }));
      };
      if (statusValue.mode === "500") return respond(500);
      if (statusValue.mode === "422") return respond(422);
      if (statusValue.mode === "lento") return setTimeout(() => respond(200), statusValue.slowMs);
      return respond(200);
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
    de: (convId) => statusValue.received.filter((r) => r.event?.conversation?.id === convId),
    turnOff: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    turnOn: listen,
  };
}

// ---------------------------------------------------------------------------
// Atajos del guion
// ---------------------------------------------------------------------------

let nMessage = 0;
async function inboundWa(from, name, text, extra = {}) {
  nMessage++;
  return api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.despacho.${RUN}.${nMessage}`,
      ...extra,
    }),
  });
}

async function conversations() {
  return (await api("/api/conversations")).json?.conversations ?? [];
}

const convDe = (name) =>
  until(async () => (await conversations()).find((c) => c.contact.name === name));

async function messagesOf(convId) {
  return (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];
}

const brainStatus = async () => (await api("/api/agent/brain-status")).json;

/** Lo que escribe el operador desde la bandeja. */
const byHand = (convId, text) =>
  api(`/api/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

/** Espera a que ese texto del cliente esté guardado; devuelve el mensaje. */
const inboundSaved = (convId, text) =>
  until(
    async () => (await messagesOf(convId)).find((m) => m.direction === "in" && m.text === text),
    5000,
    60
  );

/** El mock de IA: `?reset=1`, `?demoraMs=3000`; devuelve lo que se le preguntó. */
const iaMock = async (qs = "") =>
  (await api(`/api/dev/ai-mock/v1/chat/completions${qs}`)).json ?? {};

/** Las peticiones al modelo de UNA conversación: las que traen ese texto. */
const requestsWith = async (textValue) =>
  ((await iaMock()).requests ?? []).filter((p) =>
    p.messages.some((m) => m.content === textValue)
  );

/**
 * Hay casos que dependen de ganarle a la ventana de agrupado: algo tiene que
 * pasar ANTES de que venza. En una máquina cargada se puede perder esa
 * carrera, y entonces el caso no prueba nada. `preparar` devuelve `null`
 * cuando la perdió; se reintenta con otro contacto en vez de acusar al
 * producto de algo que hizo el guion.
 */
async function withOpenWindow(prepare, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const ready = await prepare(i);
    if (ready) return ready;
    console.log(`  (la ventana venció antes de tiempo; intento ${i} de ${attempts})`);
    await sleep(AFTER_THE_WINDOW);
  }
  return null;
}

/** Lo que tarda en vencer la ventana más un margen para el worker y `next dev`. */
const AFTER_THE_WINDOW = COALESCE + 4000;

// ---------------------------------------------------------------------------

async function main() {
  if (!(process.env.BRAIN_DISPATCH_URL ?? "").trim()) {
    console.log("Sin BRAIN_DISPATCH_URL: modo AGENTE INCLUIDO (025).\n");
    await scriptIncluded();
    console.log(`\n${checks - failures}/${checks} checks en verde`);
    process.exit(failures > 0 ? 1 : 0);
  }
  if (BOT_KEY.length < 16) {
    console.error("BOT_API_KEY ausente o corta (<16): sin ella no hay despacho.");
    process.exit(1);
  }
  let url;
  try {
    url = new URL(process.env.BRAIN_DISPATCH_URL ?? "");
  } catch {
    console.error(
      "Falta BRAIN_DISPATCH_URL. Arranca la app con algo como\n" +
        "  BRAIN_DISPATCH_URL=http://127.0.0.1:3190/vocero/dispatch\n" +
        "y corre este guion con el mismo entorno."
    );
    process.exit(1);
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    console.error(
      `BRAIN_DISPATCH_URL apunta a ${url.host}: este guion levanta el cerebro de prueba en esta máquina.`
    );
    process.exit(1);
  }

  const brain = await startBrain(url);
  try {
    await script(brain, url);
  } finally {
    await brain.turnOff().catch(() => {});
  }

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

/** Operador, WhatsApp por el wa-mock y el interruptor del agente encendido. */
async function prepare() {
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
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("conexión de WhatsApp guardada (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  // A propósito: con IA configurada y el interruptor encendido, el agente
  // incluido contestaría. El despacho tiene que callarlo.
  const profile = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  ok("interruptor del agente incluido encendido", profile.res.ok, JSON.stringify(profile.json));
}

async function script(brain, url) {
  console.log("== Setup: operador, WhatsApp y agente incluido ENCENDIDO ==");
  await prepare();

  const before = await brainStatus();
  ok(
    "el CRM dice que el despacho está activo",
    before?.dispatch?.active === true && before?.dispatch?.problem === null,
    JSON.stringify(before?.dispatch)
  );
  if (before?.dispatch?.active !== true) {
    console.error(
      "\nLa app no tiene el despacho activo: revisa que arrancó con BRAIN_DISPATCH_URL y BOT_API_KEY."
    );
    return;
  }
  ok(
    "el agente incluido tiene con qué contestar (IA + interruptor), y está en silencio",
    before.embedded?.configured === true &&
      before.embedded?.enabled === true &&
      before.embedded?.silenced === true &&
      before.embedded?.answering === false,
    JSON.stringify(before.embedded)
  );
  ok("sin aviso de doble respuesta", before.warning === null, String(before.warning));

  await oneMessage(brain);
  await burst(brain);
  await inFlight(brain);
  await whileThinks(brain);
  await personInWindow(brain);
  await attachment(brain);
  await otherChannels(brain);
  await pauses(brain);
  await lab(brain);
  await brainDown(brain);
  await card(brain, url);
}

// ---------------------------------------------------------------------------
// Historia 1 — un mensaje llega al cerebro
// ---------------------------------------------------------------------------

async function oneMessage(brain) {
  console.log("\n== AC1: un WhatsApp llega al cerebro, firmado, y la respuesta sale ==");
  const nameValue = `Ana Despacho ${BRAND}`;
  const textValue = `hola, ¿tienen el modelo azul? ${BRAND}`;
  const t0 = Date.now();
  const inb = await inboundWa(phone(1), nameValue, textValue);
  ok("el entrante se entregó al webhook", inb.res.ok, JSON.stringify(inb.json));

  const conv = await convDe(nameValue);
  ok("el mensaje está en la bandeja antes de cualquier despacho", Boolean(conv));
  if (!conv) return;

  const arrived = await until(() => brain.de(conv.id)[0], COALESCE + 12000);
  ok("el cerebro recibió un despacho", Boolean(arrived));
  if (!arrived) return;
  ok(
    `esperó la ventana de agrupado (${COALESCE} ms) antes de despachar`,
    arrived.at - t0 >= COALESCE - 250,
    `${arrived.at - t0} ms`
  );

  const e = arrived.event;
  ok("la firma valida sobre el cuerpo crudo con BOT_API_KEY", arrived.signatureOk);
  ok(
    "con las cabeceras del contrato",
    arrived.headers.dispatch === e.dispatchId &&
      Boolean(arrived.headers.org) &&
      arrived.headers.event === null &&
      String(arrived.headers.kind).startsWith("application/json"),
    JSON.stringify(arrived.headers)
  );
  ok("dispatchId con prefijo dsp_", /^dsp_[0-9a-z]{20}$/.test(e.dispatchId), e.dispatchId);
  ok(
    "las claves del evento, en el orden del contrato",
    JSON.stringify(Object.keys(e)) === JSON.stringify(EVENT_KEYS),
    Object.keys(e).join(",")
  );
  ok(
    "conversación: la de la bandeja, canal whatsapp, IA activa y ventana abierta",
    e.conversation.id === conv.id &&
      e.conversation.channel === "whatsapp" &&
      e.conversation.aiEnabled === true &&
      e.conversation.windowOpen === true &&
      typeof e.conversation.windowExpiresAt === "string",
    JSON.stringify(e.conversation)
  );
  ok(
    "un mensaje, el del cliente, sin adjunto",
    e.messages.length === 1 &&
      e.messages[0].text === textValue &&
      e.messages[0].type === "text" &&
      e.messages[0].mediaId === null &&
      !("mimeType" in e.messages[0]),
    JSON.stringify(e.messages)
  );
  ok(
    "el evento no lleva el token de WhatsApp ni la llave",
    !arrived.raw.includes("tok-e2e") && !arrived.raw.includes(BOT_KEY)
  );

  const ctx = await bot(`/api/bot/context?conversationId=${conv.id}`);
  ok("el cerebro lee el contexto por conversationId", ctx.res.ok, String(ctx.res.status));
  const identityCrm = ctx.json?.contact?.identity ?? ctx.json?.contact?.waIdentity;
  ok(
    "la identidad del evento es la que acepta /api/bot/context",
    Boolean(identityCrm) && e.contact.identity === identityCrm && e.contact.displayName === nameValue,
    `${e.contact.identity} vs ${identityCrm}`
  );

  const response = `Sí, lo tenemos en azul ${BRAND}`;
  const sending = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: e.conversation.id, text: response }),
  });
  ok("el cerebro contesta por /api/bot/messages → 200", sending.res.ok, JSON.stringify(sending.json));
  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok("la respuesta salió por WhatsApp (wa-mock)", JSON.stringify(outbox).includes(response));

  console.log("\n== AC10: el agente incluido no contestó ==");
  await sleep(AFTER_THE_WINDOW);
  const outbound = (await messagesOf(conv.id)).filter((m) => m.direction === "out");
  ok(
    "el único saliente es el del cerebro",
    outbound.length === 1 && outbound[0].text === response,
    JSON.stringify(outbound.map((m) => m.text))
  );
  ok("y el cerebro recibió ese turno una sola vez", brain.de(conv.id).length === 1);
}

async function burst(brain) {
  console.log("\n== AC2: cinco mensajes seguidos → un despacho ==");
  const nameValue = `Beto Ráfaga ${BRAND}`;
  const texts = [1, 2, 3, 4, 5].map((i) => `mensaje ${i} de la ráfaga ${BRAND}`);
  /**
   * Cada mensaje se espera en la bandeja antes de mandar el siguiente. El
   * webhook contesta 200 y DESPUÉS ingiere (`after`): mandar los cinco sin
   * esperar es poner cinco ingestas a correr a la vez, y el orden en que se
   * guardan deja de ser el orden en que se mandaron. El «en orden» de abajo se
   * ponía rojo de vez en cuando por eso, no por el despacho. Siguen cayendo
   * todos dentro de la ventana, que cada uno empuja.
   */
  let conv = null;
  for (const t of texts) {
    await inboundWa(phone(2), nameValue, t);
    conv ??= await convDe(nameValue);
    if (conv) await inboundSaved(conv.id, t);
  }
  if (!conv) return ok("la conversación de la ráfaga existe", false);

  const arrived = await until(() => brain.de(conv.id)[0], COALESCE + 12000);
  ok("llegó un despacho", Boolean(arrived));
  await sleep(AFTER_THE_WINDOW);
  const everyone = brain.de(conv.id);
  ok("exactamente uno", everyone.length === 1, String(everyone.length));
  ok(
    "con los cinco mensajes, en orden",
    JSON.stringify(everyone[0]?.event.messages.map((m) => m.text)) === JSON.stringify(texts),
    JSON.stringify(everyone[0]?.event.messages.map((m) => m.text))
  );
  ok(
    "firstMessageAt ≤ lastMessageAt",
    Date.parse(everyone[0]?.event.firstMessageAt) <= Date.parse(everyone[0]?.event.lastMessageAt)
  );
}

async function inFlight(brain) {
  console.log("\n== AC5: un mensaje que llega con el despacho en vuelo no se pierde ==");
  const nameValue = `Caro EnVuelo ${BRAND}`;
  brain.state.slowMs = 3000;
  brain.state.mode = "lento";
  try {
    await inboundWa(phone(3), nameValue, `primero ${BRAND}`);
    const conv = await convDe(nameValue);
    if (!conv) return ok("la conversación existe", false);
    const first = await until(() => brain.de(conv.id)[0], COALESCE + 12000, 50);
    ok("el primer despacho está en vuelo (el cerebro tarda 3 s en acusar)", Boolean(first));
    // Justo ahora: el CRM sigue esperando el 2xx del primero.
    await inboundWa(phone(3), nameValue, `segundo ${BRAND}`);
    brain.state.mode = "ok";

    const second = await until(() => brain.de(conv.id)[1], 3000 + COALESCE + 12000);
    ok("llega un segundo despacho", Boolean(second));
    ok(
      "con otro dispatchId",
      Boolean(second) && second.event.dispatchId !== first?.event.dispatchId
    );
    ok(
      "que trae la ráfaga completa: lo ya despachado y lo nuevo",
      JSON.stringify(second?.event.messages.map((m) => m.text)) ===
        JSON.stringify([`primero ${BRAND}`, `segundo ${BRAND}`]),
      JSON.stringify(second?.event.messages.map((m) => m.text))
    );
  } finally {
    brain.state.mode = "ok";
  }
}

// ---------------------------------------------------------------------------
// 025 — El despacho recuerda qué debe
// ---------------------------------------------------------------------------

async function whileThinks(brain) {
  console.log("\n== 025·AC1: un mensaje que entra mientras el cerebro PIENSA viaja aunque ya haya respuesta ==");
  /**
   * No es el hueco de AC5: aquí el despacho YA se entregó. El cerebro acusó
   * recibo y está pensando (10 a 40 s en la vida real), el cliente escribe otra
   * vez, y la respuesta al primer mensaje sale antes de que venza la ventana
   * del segundo. La ráfaga se corta en el último saliente, así que ese segundo
   * mensaje quedaba DETRÁS de la respuesta y nadie lo despachaba.
   */
  const testCase = await withOpenWindow(async (i) => {
    const nameValue = `Lalo Pensando ${i} ${BRAND}`;
    const one = `hola, ¿tienen taladros? ${i} ${BRAND}`;
    const dos = `¿y hacen envíos a Celaya? ${i} ${BRAND}`;
    await inboundWa(phone(20 + i), nameValue, one);
    const conv = await convDe(nameValue);
    if (!conv) return null;
    const first = await until(() => brain.de(conv.id)[0], COALESCE + 12000, 50);
    if (!first) return null;

    await inboundWa(phone(20 + i), nameValue, dos);
    const second = await inboundSaved(conv.id, dos);
    const response = await bot("/api/bot/messages", {
      method: "POST",
      body: JSON.stringify({ conversationId: conv.id, text: `Sí tenemos taladros ${i} ${BRAND}` }),
    });
    // Si la respuesta llegara DESPUÉS de la ventana, el segundo despacho ya
    // habría salido por el camino de siempre y el caso pasaría sin probar nada.
    if (!second || !response.res.ok || brain.de(conv.id).length !== 1) return null;
    return { conv, first: first, second: second, one: one, dos };
  });
  ok(
    "el cerebro contesta el primero con la ventana del segundo todavía abierta",
    Boolean(testCase)
  );
  if (!testCase) return;
  const { conv, first: first, second: second, dos } = testCase;

  const arrived = await until(() => brain.de(conv.id)[1], COALESCE + 12000);
  ok("llega un segundo despacho", Boolean(arrived));
  ok(
    "con exactamente el segundo mensaje: ni vacío ni repitiendo el ya contestado",
    arrived?.event.messages.length === 1 &&
      arrived.event.messages[0].id === second.id &&
      arrived.event.messages[0].text === dos,
    JSON.stringify(arrived?.event.messages.map((m) => ({ id: m.id, text: m.text })))
  );
  ok(
    "firmado, y con otro dispatchId",
    arrived?.signatureOk === true && arrived.event.dispatchId !== first.event.dispatchId
  );

  console.log("\n== 025·AC2: y no deja nada colgando ==");
  await sleep(AFTER_THE_WINDOW);
  ok(
    "no hay un tercer despacho: lo ya entregado no se vuelve a deber",
    brain.de(conv.id).length === 2,
    String(brain.de(conv.id).length)
  );
  const after = (await conversations()).find((c) => c.id === conv.id);
  ok(
    "la conversación sigue con la IA, sin traspaso",
    after?.aiEnabled === true && !after?.handoffAt,
    JSON.stringify({ ai: after?.aiEnabled, handoffAt: after?.handoffAt, reason: after?.handoffReason })
  );
  ok("no queda nada en espera", (await brainStatus())?.dispatch?.pending === 0);
}

async function personInWindow(brain) {
  console.log("\n== 025·AC4: si una persona contesta dentro de la ventana, el cerebro no recibe nada ==");
  /**
   * La otra cara. Que un mensaje viaje aunque tenga una respuesta después vale
   * para la respuesta del AGENTE, que no lo había leído. Si contestó una
   * persona, ese mensaje ya está atendido: mandárselo al cerebro sería
   * contestarle dos veces al cliente. Y un despacho sin mensajes no se entrega.
   */
  const failuresBefore = (await brainStatus())?.dispatch?.lastFailure?.at ?? null;
  const testCase = await withOpenWindow(async (i) => {
    const nameValue = `Mara Atendida ${i} ${BRAND}`;
    await inboundWa(phone(30 + i), nameValue, `¿a qué hora cierran? ${i} ${BRAND}`);
    const conv = await convDe(nameValue);
    if (!conv) return null;
    const sending = await byHand(conv.id, `Cerramos a las 7 ${i} ${BRAND}`);
    if (!sending.res.ok || brain.de(conv.id).length !== 0) return null;
    return { conv, name: nameValue, i };
  });
  ok("una persona contesta con la ventana todavía abierta", Boolean(testCase));
  if (!testCase) return;
  const { conv, name: nameValue, i } = testCase;

  await sleep(AFTER_THE_WINDOW);
  ok(
    "el cerebro no recibe nada: ni el mensaje ya atendido ni un despacho vacío",
    brain.de(conv.id).length === 0,
    JSON.stringify(brain.de(conv.id).map((r) => ({ id: r.event?.dispatchId, messages: r.event?.messages?.length })))
  );

  console.log("\n== 025·AC5: se descarta, no cuenta como caída ==");
  const st = await brainStatus();
  ok("no queda nada en espera", st?.dispatch?.pending === 0, JSON.stringify(st?.dispatch));
  ok(
    "no se registró ningún fallo nuevo del cerebro",
    (st?.dispatch?.lastFailure?.at ?? null) === failuresBefore,
    JSON.stringify(st?.dispatch?.lastFailure)
  );
  const after = (await conversations()).find((c) => c.id === conv.id);
  ok(
    "la conversación NO pasó a un humano: la IA sigue encendida",
    after?.aiEnabled === true && !after?.handoffAt,
    JSON.stringify({ ai: after?.aiEnabled, handoffAt: after?.handoffAt, reason: after?.handoffReason })
  );

  const other = `¿y los domingos? ${i} ${BRAND}`;
  await inboundWa(phone(30 + i), nameValue, other);
  const arrived = await until(() => brain.de(conv.id)[0], COALESCE + 12000);
  ok(
    "el siguiente mensaje del cliente sí se despacha, y solo ese",
    arrived?.event.messages.length === 1 && arrived.event.messages[0].text === other,
    JSON.stringify(arrived?.event.messages.map((m) => m.text))
  );
}

async function attachment(brain) {
  console.log("\n== AC4: un adjunto viaja como mediaId y se descarga por /api/bot/media ==");
  const nameValue = `Dani Adjunto ${BRAND}`;
  const mediaId = "media123";
  await inboundWa(phone(4), nameValue, undefined, {
    type: "image",
    mediaId,
    mimeType: "image/jpeg",
    caption: `foto ${BRAND}`,
  });
  const conv = await convDe(nameValue);
  if (!conv) return ok("la conversación existe", false);
  const arrived = await until(() => brain.de(conv.id)[0], COALESCE + 12000);
  const m = arrived?.event.messages[0];
  ok(
    "el evento trae mediaId, mimeType y caption",
    m?.type === "image" && m?.mediaId === mediaId && m?.mimeType === "image/jpeg" && m?.caption === `foto ${BRAND}`,
    JSON.stringify(m)
  );
  ok("y no el archivo", !arrived?.raw.includes("base64"));
  if (m?.mediaId) {
    const media = await fetch(`${BASE}/api/bot/media/${m.mediaId}`, {
      headers: { "x-api-key": BOT_KEY },
    });
    const bytes = (await media.arrayBuffer()).byteLength;
    ok(
      "ese mediaId se descarga por /api/bot/media",
      media.status === 200 && bytes > 0 && String(media.headers.get("content-type")).startsWith("image/"),
      `${media.status} ${media.headers.get("content-type")} ${bytes} bytes`
    );
  }
}

/**
 * 023: guardar una conexión por Zernio resuelve la cuenta contra las de la
 * llave, así que el simulador tiene que servirlas.
 */
async function seedZernioAccounts() {
  await api("/api/dev/zernio-mock/_accounts", {
    method: "POST",
    body: JSON.stringify({
      accounts: [
        {
          _id: "zernio-ig-despacho",
          platform: "instagram",
          username: "ig.despacho",
          platformUserId: "ig-user-despacho",
          isActive: true,
          platformStatus: "active",
        },
        {
          _id: "zernio-tt-despacho",
          platform: "tiktok",
          username: "tt.despacho",
          isActive: true,
          platformStatus: "active",
          tiktokAccountType: "business",
        },
      ],
    }),
  });
  await api("/api/dev/zernio-mock/_webhooks", {
    method: "POST",
    body: JSON.stringify({ webhooks: [] }),
  });
}

async function otherChannels(brain) {
  console.log("\n== AC3: Messenger e Instagram se despachan igual ==");
  if (!CHANNELS.includes("messenger")) {
    console.log("  SKIP Messenger: CHANNELS no lo incluye");
  } else {
    const PAGE = "page-demo-001";
    const psid = `psid-despacho-${RUN}`;
    const c = await api("/api/settings/messenger", {
      method: "PUT",
      body: JSON.stringify({ source: "meta", pageId: PAGE, token: "token-pagina-demo" }),
    });
    ok("página de Messenger conectada (wa-mock)", c.res.ok, JSON.stringify(c.json));
    const textValue = `hola por Messenger ${BRAND}`;
    const wh = await fetch(`${BASE}/api/webhooks/messenger/${VERIFY_TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        object: "page",
        entry: [
          {
            id: PAGE,
            time: Date.now(),
            messaging: [
              {
                sender: { id: psid },
                recipient: { id: PAGE },
                timestamp: Date.now(),
                message: { mid: `m_${psid}_1`, text: textValue },
              },
            ],
          },
        ],
      }),
    });
    ok("el webhook de Messenger respondió 200", wh.status === 200, String(wh.status));
    const conv = await until(async () =>
      (await conversations()).find((x) => x.channel === "messenger" && x.preview?.includes(BRAND))
    );
    const arrived = conv ? await until(() => brain.de(conv.id)[0], COALESCE + 12000) : null;
    ok(
      "despacho con canal messenger e identidad fb:",
      arrived?.event.conversation.channel === "messenger" &&
        arrived?.event.contact.identity === `fb:${psid}` &&
        arrived?.event.messages[0]?.text === textValue &&
        arrived?.signatureOk === true,
      JSON.stringify({ c: arrived?.event.conversation.channel, i: arrived?.event.contact.identity })
    );
    if (arrived) {
      const r = await bot("/api/bot/messages", {
        method: "POST",
        body: JSON.stringify({ conversationId: conv.id, text: `claro, por aquí mismo ${BRAND}` }),
      });
      ok("el cerebro contesta por el mismo /api/bot/messages", r.res.ok, JSON.stringify(r.json));
    }
  }

  if (!CHANNELS.includes("instagram")) {
    console.log("  SKIP Instagram: CHANNELS no lo incluye");
    return;
  }
  // Instagram entra por Zernio y Messenger por Meta: el cerebro recibe el
  // mismo evento venga de donde venga. Solo contra el mock: sin él, guardar la
  // conexión le preguntaría a la API real de Zernio.
  if (!(process.env.ZERNIO_BASE_URL ?? "").includes("/api/dev/zernio-mock")) {
    console.log("  SKIP Instagram: ZERNIO_BASE_URL no apunta al zernio-mock");
    return;
  }
  const ACCOUNT = "zernio-ig-despacho";
  const SECRET = "secreto-del-webhook-de-zernio";
  const igsid = `igsid-despacho-${RUN}`;
  await seedZernioAccounts();
  const c = await api("/api/settings/instagram", {
    method: "PUT",
    body: JSON.stringify({
      source: "zernio",
      igUserId: "ig-user-despacho",
      accountRef: ACCOUNT,
      token: "zernio-key-demo",
      webhookSecret: SECRET,
    }),
  });
  ok("perfil de Instagram conectado por Zernio (zernio-mock)", c.res.ok, JSON.stringify(c.json));
  if (!c.res.ok) return;
  const textValue = `hola por Instagram ${BRAND}`;
  const body = JSON.stringify({
    id: `evt-${RUN}`,
    event: "message.received",
    message: {
      id: `zmsg-ig-${RUN}`,
      conversationId: `zconv-ig-${RUN}`,
      direction: "incoming",
      text: textValue,
      sender: { id: igsid, name: `Ivana Insta ${BRAND}`, username: "ivana" },
    },
    account: { id: ACCOUNT, platform: "instagram" },
  });
  const wh = await fetch(`${BASE}/api/webhooks/ig/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body: body,
  });
  ok("el webhook de Instagram respondió 200", wh.status === 200, String(wh.status));
  const conv = await until(async () =>
    (await conversations()).find((x) => x.channel === "instagram" && x.preview?.includes(BRAND))
  );
  const arrived = conv ? await until(() => brain.de(conv.id)[0], COALESCE + 12000) : null;
  ok(
    "despacho con canal instagram e identidad ig:",
    arrived?.event.conversation.channel === "instagram" &&
      arrived?.event.contact.identity === `ig:${igsid}` &&
      arrived?.event.messages[0]?.text === textValue &&
      arrived?.signatureOk === true,
    JSON.stringify({ c: arrived?.event.conversation.channel, i: arrived?.event.contact.identity })
  );
  ok(
    "y el evento no dice por qué proveedor entró",
    Boolean(arrived) && !arrived.raw.toLowerCase().includes("zernio"),
  );

  await tiktok(brain);
}

/** 022 — TikTok entra por Zernio y se despacha como los demás, con su ventana. */
async function tiktok(brain) {
  if (!CHANNELS.includes("tiktok")) {
    console.log("  SKIP TikTok: CHANNELS no lo incluye");
    return;
  }
  console.log("\n== 022·AC8: TikTok se despacha con su canal y su ventana de 48 h ==");
  const ACCOUNT = "zernio-tt-despacho";
  const SECRET = "secreto-del-webhook-de-zernio";
  const sender = `tt-despacho-${RUN}`;
  await seedZernioAccounts();
  const c = await api("/api/settings/tiktok", {
    method: "PUT",
    body: JSON.stringify({ accountRef: ACCOUNT, token: "zernio-key-demo", webhookSecret: SECRET }),
  });
  ok("cuenta de TikTok conectada por Zernio (zernio-mock)", c.res.ok, JSON.stringify(c.json));
  if (!c.res.ok) return;
  const textValue = `hola por TikTok ${BRAND}`;
  const thread = `zconv-tt-${RUN}`;
  const body = JSON.stringify({
    id: `evt-tt-${RUN}`,
    event: "message.received",
    message: {
      id: `zmsg-tt-${RUN}`,
      conversationId: thread,
      platform: "tiktok",
      direction: "incoming",
      text: textValue,
      sender: { id: sender, name: `Tadeo Tok ${BRAND}`, username: "tadeo" },
    },
    conversation: { id: thread },
    account: { id: ACCOUNT, accountId: ACCOUNT, platform: "tiktok" },
  });
  const t0 = Date.now();
  const wh = await fetch(`${BASE}/api/webhooks/tiktok/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body: body,
  });
  ok("el webhook de TikTok respondió 200", wh.status === 200, String(wh.status));
  const conv = await until(async () =>
    (await conversations()).find((x) => x.channel === "tiktok" && x.preview?.includes(BRAND))
  );
  const arrived = conv ? await until(() => brain.de(conv.id)[0], COALESCE + 12000) : null;
  ok(
    "despacho con canal tiktok e identidad tt:",
    arrived?.event.conversation.channel === "tiktok" &&
      arrived?.event.contact.identity === `tt:${sender}` &&
      arrived?.event.messages[0]?.text === textValue &&
      arrived?.signatureOk === true,
    JSON.stringify({ c: arrived?.event.conversation.channel, i: arrived?.event.contact.identity })
  );
  const expires = Date.parse(arrived?.event.conversation.windowExpiresAt ?? "");
  ok(
    "windowExpiresAt cae a 48 h del mensaje, no a 24",
    Math.abs(expires - t0 - 48 * 3600_000) < 5 * 60_000,
    `${((expires - t0) / 3600_000).toFixed(2)} h`
  );
  if (arrived) {
    const r = await bot("/api/bot/messages", {
      method: "POST",
      body: JSON.stringify({ conversationId: conv.id, text: `claro, por TikTok ${BRAND}` }),
    });
    ok("el cerebro contesta por el mismo /api/bot/messages", r.res.ok, JSON.stringify(r.json));
  }
}

// ---------------------------------------------------------------------------
// Historia 3 — quién contesta
// ---------------------------------------------------------------------------

async function pauses(brain) {
  console.log("\n== AC11: una conversación en pausa no se despacha ==");
  const nameValue = `Eli Pausa ${BRAND}`;
  await inboundWa(phone(5), nameValue, `antes de la pausa ${BRAND}`);
  const conv = await convDe(nameValue);
  if (!conv) return ok("la conversación existe", false);
  await until(() => brain.de(conv.id)[0], COALESCE + 12000);
  ok("el primer turno sí se despachó", brain.de(conv.id).length === 1);

  const pause = await api(`/api/conversations/${conv.id}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("el operador pausa la IA de esa conversación", pause.res.ok);
  await inboundWa(phone(5), nameValue, `ya en pausa ${BRAND}`);
  await sleep(AFTER_THE_WINDOW);
  ok("el mensaje en pausa no llegó al cerebro", brain.de(conv.id).length === 1, String(brain.de(conv.id).length));
  ok(
    "pero sí está en la bandeja",
    (await messagesOf(conv.id)).some((m) => m.text === `ya en pausa ${BRAND}`)
  );

  console.log("\n== AC11: pausar DURANTE la ventana descarta el turno, sin caer a humano ==");
  const nombre2 = `Fer Ventana ${BRAND}`;
  await inboundWa(phone(6), nombre2, `primer turno ${BRAND}`);
  const conv2 = await convDe(nombre2);
  if (!conv2) return ok("la conversación existe", false);
  await until(() => brain.de(conv2.id)[0], COALESCE + 12000);
  await inboundWa(phone(6), nombre2, `me arrepentí ${BRAND}`);
  // La ingesta corre después de responder el webhook: se espera a que el
  // turno esté ENCOLADO para pausar con él dentro de su ventana. Pausar antes
  // probaría otra cosa (que no se encola), no que se descarta.
  const queued = await until(
    async () => (await brainStatus())?.dispatch?.pending === 1,
    COALESCE,
    40
  );
  ok("el segundo turno está encolado, esperando su ventana", Boolean(queued));
  const turnOff = await api(`/api/conversations/${conv2.id}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  /**
   * Aparte, y antes: si la IA no llegó a apagarse DENTRO de la ventana, el
   * despacho sale —como debe— y la comprobación de abajo se pondría roja por
   * algo que hizo el guion, no el producto (cloud #116).
   */
  ok(
    "el operador apaga la IA con la ventana todavía abierta",
    turnOff.res.ok && brain.de(conv2.id).length === 1,
    `PATCH ${turnOff.res.status}; el cerebro llevaba ${brain.de(conv2.id).length}`
  );
  await sleep(AFTER_THE_WINDOW);
  ok(
    "el turno encolado no se entregó",
    brain.de(conv2.id).length === 1,
    // De quién era: un despacho de más no se puede atribuir sin esto.
    JSON.stringify(brain.de(conv2.id).map((r) => ({ id: r.event?.dispatchId, texts: r.event?.messages?.map((m) => m.text) })))
  );
  const after = (await conversations()).find((c) => c.id === conv2.id);
  ok(
    "y la conversación NO quedó traspasada por error: la pausó una persona",
    after?.handoffReason !== "error",
    JSON.stringify({ handoffAt: after?.handoffAt, reason: after?.handoffReason })
  );
  ok("no queda nada en espera", (await brainStatus())?.dispatch?.pending === 0);
}

async function lab(brain) {
  console.log("\n== AC13: el Laboratorio no se despacha ==");
  const total = brain.state.received.length;
  const run = await api("/api/lab/runs", { method: "POST" });
  if (!run.res.ok) {
    console.log(`  SKIP no se pudo iniciar una corrida (${run.res.status}): ${JSON.stringify(run.json)}`);
    return;
  }
  const id = run.json?.runId ?? run.json?.id;
  const end = await until(
    async () => {
      const r = (await api(`/api/lab/runs/${id}`)).json;
      const st = r?.run?.status ?? r?.status;
      return st && st !== "running" ? st : null;
    },
    180000,
    1000
  );
  ok("la corrida del Laboratorio terminó (con el agente incluido)", end === "done", String(end));
  await sleep(AFTER_THE_WINDOW);
  const newOnes = brain.state.received.slice(total);
  ok(
    "ningún cliente simulado llegó al cerebro",
    newOnes.length === 0,
    JSON.stringify(newOnes.map((r) => r.event?.contact?.displayName))
  );
}

// ---------------------------------------------------------------------------
// Historia 2 — el cerebro falla
// ---------------------------------------------------------------------------

async function brainDown(brain) {
  console.log("\n== AC6/AC7: el cerebro responde 500 → tres intentos y a un humano ==");
  const nameValue = `Gabi Caído ${BRAND}`;
  brain.state.mode = "500";
  const t0 = Date.now();
  await inboundWa(phone(7), nameValue, `¿hay alguien? ${BRAND}`);
  const conv = await convDe(nameValue);
  ok("el mensaje está en la bandeja aunque el cerebro esté caído", Boolean(conv));
  if (!conv) return;

  const handoff = await until(
    async () => (await conversations()).find((c) => c.id === conv.id && c.handoffAt),
    COALESCE + 30000
  );
  ok("la conversación pasó a un humano", Boolean(handoff), `${Date.now() - t0} ms`);
  ok(
    "con la IA en pausa y motivo error",
    handoff?.aiEnabled === false && handoff?.handoffReason === "error",
    JSON.stringify({ ai: handoff?.aiEnabled, reason: handoff?.handoffReason })
  );
  const attempts = brain.de(conv.id);
  ok("fueron tres intentos", attempts.length === 3, String(attempts.length));
  ok(
    "del MISMO despacho (el dispatchId es la clave de idempotencia)",
    new Set(attempts.map((r) => r.event.dispatchId)).size === 1
  );
  ok("todos firmados", attempts.every((r) => r.signatureOk));
  ok(
    "con espera creciente entre ellos (~1 s y ~4 s)",
    attempts.length === 3 &&
      attempts[1].at - attempts[0].at >= 900 &&
      attempts[2].at - attempts[1].at >= 3600,
    attempts.length === 3 ? `${attempts[1].at - attempts[0].at} ms, ${attempts[2].at - attempts[1].at} ms` : ""
  );
  await sleep(3000);
  ok("y no hay un cuarto", brain.de(conv.id).length === 3);

  const st = await brainStatus();
  ok(
    "«Quién responde» enseña el fallo con su motivo",
    st?.dispatch?.lastFailure?.detail?.includes("500") === true,
    JSON.stringify(st?.dispatch)
  );

  await inboundWa(phone(7), nameValue, `sigo aquí ${BRAND}`);
  await sleep(AFTER_THE_WINDOW);
  ok(
    "ya con un humano, los mensajes nuevos no se despachan",
    brain.de(conv.id).length === 3,
    String(brain.de(conv.id).length)
  );

  console.log("\n== AC8: un 4xx no se reintenta ==");
  const nombre2 = `Hugo Rechazo ${BRAND}`;
  brain.state.mode = "422";
  await inboundWa(phone(8), nombre2, `esto no lo entiendes ${BRAND}`);
  const conv2 = await convDe(nombre2);
  if (!conv2) return ok("la conversación existe", false);
  const traspaso2 = await until(
    async () => (await conversations()).find((c) => c.id === conv2.id && c.handoffAt),
    COALESCE + 15000
  );
  ok("cae a un humano", traspaso2?.handoffReason === "error", JSON.stringify(traspaso2?.handoffReason));
  await sleep(6000);
  ok("con un solo intento", brain.de(conv2.id).length === 1, String(brain.de(conv2.id).length));

  console.log("\n== AC6: el cerebro ni siquiera acepta la conexión ==");
  const nombre3 = `Iris Apagado ${BRAND}`;
  brain.state.mode = "ok";
  await brain.turnOff();
  try {
    await inboundWa(phone(9), nombre3, `¿siguen ahí? ${BRAND}`);
    const conv3 = await convDe(nombre3);
    ok("el mensaje está en la bandeja", Boolean(conv3));
    const traspaso3 = conv3
      ? await until(
          async () => (await conversations()).find((c) => c.id === conv3.id && c.handoffAt),
          COALESCE + 30000
        )
      : null;
    ok("cae a un humano", traspaso3?.handoffReason === "error");
    const st3 = await brainStatus();
    ok(
      "el motivo dice que no se pudo conectar, sin URL ni llave",
      st3?.dispatch?.lastFailure?.detail === "no se pudo conectar con el cerebro",
      JSON.stringify(st3?.dispatch?.lastFailure)
    );
  } finally {
    await brain.turnOn();
  }

  console.log("\n== El cerebro vuelve: el siguiente cliente se atiende ==");
  const nombre4 = `Juan Vuelve ${BRAND}`;
  await inboundWa(phone(10), nombre4, `hola de nuevo ${BRAND}`);
  const conv4 = await convDe(nombre4);
  const arrived = conv4 ? await until(() => brain.de(conv4.id)[0], COALESCE + 12000) : null;
  ok("un cliente nuevo sí se despacha", Boolean(arrived) && arrived.signatureOk);
  const st4 = await until(async () => {
    const s = await brainStatus();
    const d = s?.dispatch;
    return d?.lastDeliveredAt && d?.lastFailure && Date.parse(d.lastDeliveredAt) > Date.parse(d.lastFailure.at)
      ? s
      : null;
  }, 8000);
  ok("y la última entrega ya es posterior al último fallo", Boolean(st4));
}

// ---------------------------------------------------------------------------
// Historia 4 — se ve en «Quién responde»
// ---------------------------------------------------------------------------

async function card(brain, url) {
  console.log("\n== AC14–AC16: «Quién responde» ==");
  const st = await brainStatus();
  const d = st?.dispatch ?? {};
  ok(
    "dispatch: activo, con host y sin problema",
    d.active === true && d.host === url.host && d.problem === null,
    JSON.stringify(d)
  );
  ok(
    "con la última entrega y sin turnos en espera",
    typeof d.lastDeliveredAt === "string" && d.pending === 0,
    JSON.stringify(d)
  );
  const raw = JSON.stringify(st);
  ok(
    "solo el host: ni la ruta de la URL ni la llave",
    !raw.includes(url.pathname) && !raw.includes(BOT_KEY)
  );
  ok(
    "las llaves de antes siguen ahí",
    typeof st?.embedded?.answering === "boolean" &&
      typeof st?.external?.active === "boolean" &&
      "warning" in (st ?? {}) &&
      "lastSeenAt" in (st?.external ?? {})
  );
  ok("el cerebro cuenta como el que contesta", st?.external?.active === true);
  const anon = await fetch(`${BASE}/api/agent/brain-status`);
  ok("sin sesión → 401", anon.status === 401, String(anon.status));
  console.log(`\n  (el cerebro de prueba recibió ${brain.state.received.length} peticiones en total)`);
}

// ---------------------------------------------------------------------------
// 025 — Sin cerebro externo: el agente incluido
// ---------------------------------------------------------------------------

async function scriptIncluded() {
  console.log("== Setup: operador, WhatsApp y agente incluido ENCENDIDO ==");
  await prepare();
  await iaMock("?reset=1&demoraMs=0");
  const st = await brainStatus();
  ok(
    "no hay despacho: contesta el agente incluido",
    st?.dispatch?.active === false && st?.embedded?.answering === true,
    JSON.stringify({ dispatch: st?.dispatch, embedded: st?.embedded })
  );
  if (st?.embedded?.answering !== true) {
    console.error(
      "\nEl agente incluido no puede contestar: revisa OPENROUTER_BASE_URL → ai-mock, OPENROUTER_API_TOKEN y OPENROUTER_MODEL."
    );
    return;
  }
  try {
    await includedInFlight();
    await includedPersona();
  } finally {
    await iaMock("?reset=1&demoraMs=0");
  }
  ok(
    "y nada de esto pasó por el outbox del despacho",
    (await brainStatus())?.dispatch?.pending === 0
  );
}

async function includedInFlight() {
  console.log("\n== 025·AC6: el agente incluido atiende el mensaje que entra mientras piensa ==");
  /**
   * El turno se repite desde siempre cuando entra algo a mitad (`pending`).
   * Lo que fallaba era el ORDEN: por hora de llegada el segundo mensaje va
   * ANTES de la respuesta al primero; leído así, el modelo ve un hilo que
   * termina en su propia respuesta y lo da por contestado.
   *
   * El modelo de prueba tarda 5 s en contestar: es el hueco en el que entra
   * el segundo mensaje. Si aun así no entra a tiempo (la primera vez `next
   * dev` compila rutas), el caso se repite con otro contacto.
   */
  const DELAY_MS = 5000;
  const testCase = await withOpenWindow(async (i) => {
    const nameValue = `Nora Incluida ${i} ${BRAND}`;
    const one = `¿tienen taladros? ${i} ${BRAND}`;
    const dos = `¿mandan a Celaya? ${i} ${BRAND}`;
    await iaMock(`?demoraMs=${DELAY_MS}`);
    await inboundWa(phone(40 + i), nameValue, one);
    const conv = await convDe(nameValue);
    if (!conv) return null;
    const firstValue = await until(async () => (await requestsWith(one))[0], COALESCE + 12000, 100);
    if (firstValue?.messages.at(-1)?.content !== one) return null;

    await inboundWa(phone(40 + i), nameValue, dos);
    const second = await inboundSaved(conv.id, dos);
    const answersAt = Date.parse(firstValue.at) + DELAY_MS;
    // Si el modelo ya contestó, el segundo mensaje no entró «a mitad»: sería
    // un turno normal y el caso pasaría sin probar nada.
    if (!second || Date.now() > answersAt - 300) {
      await iaMock("?demoraMs=0");
      return null;
    }
    return { conv, one: one, dos };
  });
  ok("el segundo mensaje entró con el modelo todavía pensando en el primero", Boolean(testCase));
  if (!testCase) return;
  const { conv, one: one, dos } = testCase;

  // El segundo turno ya no necesita ir lento.
  await iaMock("?demoraMs=0");
  const outbound = await until(
    async () => {
      const out = (await messagesOf(conv.id)).filter((m) => m.direction === "out");
      return out.length >= 2 ? out : null;
    },
    DELAY_MS + COALESCE + 12000
  );

  // Que no entre en bucle: se espera otra ventana antes de contar.
  await sleep(AFTER_THE_WINDOW);
  const requests = await requestsWith(one);
  ok(
    "el agente gasta UN turno más: ni se queda callado ni entra en bucle",
    requests.length === 2,
    `turnos del modelo: ${requests.length} — con 1, el segundo mensaje se quedó sin atender`
  );

  console.log("\n== 025·AC7: y lo lee DESPUÉS de su propia respuesta ==");
  const chat = (requests[1]?.messages ?? []).map((m) => `${m.role}: ${m.content}`);
  ok(
    "cliente, agente, cliente",
    chat.length === 3 &&
      chat[0] === `user: ${one}` &&
      chat[1].startsWith("assistant: ") &&
      chat[2] === `user: ${dos}`,
    `leyó: ${JSON.stringify(chat)}`
  );

  console.log("\n== 025·AC8: el cliente recibe las dos respuestas, cada una a lo suyo ==");
  const finales = (await messagesOf(conv.id)).filter((m) => m.direction === "out");
  ok(
    "dos salientes: uno sobre los taladros y otro sobre el envío",
    finales.length === 2 &&
      finales.some((m) => m.text?.includes(one)) &&
      finales.some((m) => m.text?.includes(dos)),
    JSON.stringify((outbound ?? finales).map((m) => m.text))
  );
}

async function includedPersona() {
  console.log("\n== 025·AC5b: si una persona contesta dentro de la ventana, el agente incluido no contesta encima ==");
  await iaMock("?demoraMs=0");
  const testCase = await withOpenWindow(async (i) => {
    const nameValue = `Omar Atendido ${i} ${BRAND}`;
    const textValue = `¿a qué hora cierran? ${i} ${BRAND}`;
    await inboundWa(phone(50 + i), nameValue, textValue);
    const conv = await convDe(nameValue);
    if (!conv) return null;
    const sending = await byHand(conv.id, `Cerramos a las 7 ${i} ${BRAND}`);
    if (!sending.res.ok || (await requestsWith(textValue)).length !== 0) return null;
    return { conv, name: nameValue, text: textValue, i };
  });
  ok("una persona contesta con la ventana todavía abierta", Boolean(testCase));
  if (!testCase) return;
  const { conv, name: nameValue, text: textValue, i } = testCase;

  await sleep(AFTER_THE_WINDOW);
  ok(
    "el modelo no gastó un turno en ese mensaje",
    (await requestsWith(textValue)).length === 0,
    String((await requestsWith(textValue)).length)
  );
  const outbound = (await messagesOf(conv.id)).filter((m) => m.direction === "out");
  ok(
    "el único saliente es el de la persona",
    outbound.length === 1 && outbound[0].text === `Cerramos a las 7 ${i} ${BRAND}`,
    JSON.stringify(outbound.map((m) => m.text))
  );
  const after = (await conversations()).find((c) => c.id === conv.id);
  ok(
    "la IA de la conversación sigue encendida",
    after?.aiEnabled === true && !after?.handoffAt,
    JSON.stringify({ ai: after?.aiEnabled, handoffAt: after?.handoffAt })
  );

  const other = `¿y los domingos? ${i} ${BRAND}`;
  await inboundWa(phone(50 + i), nameValue, other);
  const response = await until(
    async () =>
      (await messagesOf(conv.id)).find((m) => m.direction === "out" && m.text?.includes(other)),
    COALESCE + 12000
  );
  ok("el siguiente mensaje del cliente sí lo contesta el agente", Boolean(response));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
