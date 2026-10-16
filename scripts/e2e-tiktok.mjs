/**
 * Self-test E2E de comportamiento — 022: canal de TikTok (por Zernio).
 *
 * Conduce la app real con los mocks: conecta la cuenta, mete mensajes por el
 * webhook como lo haría Zernio (firmados), deja que el agente incluido
 * conteste, responde desde la bandeja y empuja los límites que TikTok impone
 * —diez mensajes desde el último entrante, 48 horas, 6,000 caracteres—,
 * comprobando cada paso por las mismas superficies que usa el operador.
 *
 * Uso:
 *   1) app corriendo (`next dev`) sobre una base migrada, SIN
 *      BRAIN_DISPATCH_URL, con CHANNELS que incluya `tiktok` (y, para el
 *      reparto por plataforma, `instagram`), WA_MOCK_ENABLED=true,
 *      ZERNIO_BASE_URL → zernio-mock, OPENROUTER_BASE_URL → ai-mock con
 *      OPENROUTER_API_TOKEN y OPENROUTER_MODEL, BOT_API_KEY y
 *      AGENT_COALESCE_MS corta (1500).
 *   2) node --env-file=.env scripts/e2e-tiktok.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-tiktok.md.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((c) => c.trim());
const ACCOUNT = "zernio-tiktok-001";
const SECRET = "secreto-del-webhook-de-zernio";
const RUN = Date.now().toString(36);
/** Marca de esta corrida: el arnés se puede repetir sobre la misma base. */
const BRAND = `#${RUN}`;
const HOUR = 60 * 60 * 1000;

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
async function until(cond, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// ---------------------------------------------------------------------------
// Zernio de mentira: lo que entrega y lo que recibió
// ---------------------------------------------------------------------------

let nEvent = 0;
/** Un `message.received` con la forma de la documentación de Zernio. */
function event({ sender, name: nameValue, user: user, text, thread: thread, sentAt, over = {}, message: message = {} }) {
  nEvent++;
  return {
    id: `evt-tt-${RUN}-${nEvent}`,
    event: "message.received",
    message: {
      id: `zmsg-tt-${RUN}-${nEvent}`,
      conversationId: thread,
      platform: "tiktok",
      platformMessageId: `tt-plat-${RUN}-${nEvent}`,
      direction: "incoming",
      text: text ?? null,
      attachments: [],
      sender: { id: sender, name: nameValue ?? null, username: user ?? null },
      sentAt: (sentAt ?? new Date()).toISOString(),
      ...message,
    },
    conversation: { id: thread, status: "active" },
    account: { id: ACCOUNT, accountId: ACCOUNT, platform: "tiktok" },
    ...over,
  };
}

/** Entrega un evento al webhook, firmado como lo firma Zernio. */
async function deliver(payload, { ruta: route = "tiktok", token = VERIFY_TOKEN, signature: signature } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/webhooks/${route}/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature":
        signature ?? createHmac("sha256", SECRET).update(body).digest("hex"),
      "x-zernio-event-id": typeof payload === "object" ? payload.id : "sin-id",
    },
    body: body,
  });
  return res.status;
}

const sentByZernio = async (thread) =>
  ((await api("/api/dev/zernio-mock/_sent")).json?.sent ?? []).filter(
    (m) => m.conversationId === thread
  );

async function conversations() {
  return (await api("/api/conversations")).json?.conversations ?? [];
}

// La ingesta corre tras responder el webhook y sella `lastInboundAt` al final:
// se espera a la conversación YA con su último entrante, que es de lo que
// depende la ventana. Sin eso, en un servidor frío el check de las 30 horas
// leía la conversación a medio ingerir.
const convDe = (nameValue) =>
  until(async () =>
    (await conversations()).find((c) => c.contact.name === nameValue && c.lastInboundAt !== null)
  );

async function messagesOf(convId) {
  return (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];
}

const byHand = (convId, text) =>
  api(`/api/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

/** La respuesta del agente incluido a ese texto del cliente. */
const agentResponse = (convId, customerText) =>
  until(
    async () =>
      (await messagesOf(convId)).find(
        (m) => m.direction === "out" && m.aiGenerated && m.text?.includes(customerText.slice(0, 60))
      ),
    COALESCE + 12000
  );

// ---------------------------------------------------------------------------

async function main() {
  if (!CHANNELS.includes("tiktok")) {
    console.error("CHANNELS no incluye `tiktok`: arranca la app con el canal encendido.");
    process.exit(1);
  }
  if ((process.env.BRAIN_DISPATCH_URL ?? "").trim()) {
    console.error(
      "La app tiene BRAIN_DISPATCH_URL: este guion necesita al agente incluido. " +
        "El despacho de TikTok se comprueba en scripts/e2e-dispatch.mjs."
    );
    process.exit(1);
  }

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
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));
  await api("/api/dev/zernio-mock/_reset", { method: "POST" });
  // 023: la cuenta se resuelve contra las de la llave; el simulador las sirve.
  await api("/api/dev/zernio-mock/_accounts", {
    method: "POST",
    body: JSON.stringify({
      accounts: [
        {
          _id: ACCOUNT,
          platform: "tiktok",
          username: "negocio.demo",
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
  const profile = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  ok("agente incluido encendido", profile.res.ok, JSON.stringify(profile.json));

  await connect();
  const thread = await receiveAndAnswer();
  if (thread) await limits(thread);
  await window();
  await discards();
  await routing();

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Historia 4 — Conectar
// ---------------------------------------------------------------------------

async function connect() {
  console.log("\n== AC14: la llave se prueba antes de guardar ==");
  const bad = await api("/api/settings/tiktok", {
    method: "PUT",
    body: JSON.stringify({ accountRef: `otra-${RUN}`, token: "sk_llave-invalid" }),
  });
  ok(
    "una llave que Zernio rechaza → 422 invalid_token",
    bad.res.status === 422 && bad.json?.error?.code === "invalid_token",
    `${bad.res.status} ${JSON.stringify(bad.json)}`
  );
  const afterTheBadOne = (await api("/api/settings/tiktok")).json?.connection;
  ok(
    "y no se guardó",
    !afterTheBadOne || afterTheBadOne.accountRef !== `otra-${RUN}`,
    JSON.stringify(afterTheBadOne)
  );

  const good = await api("/api/settings/tiktok", {
    method: "PUT",
    body: JSON.stringify({
      accountRef: ACCOUNT,
      username: "@negocio.demo",
      token: "sk_llave-de-zernio-demo",
      webhookSecret: SECRET,
    }),
  });
  ok("una llave buena → 200", good.res.ok, JSON.stringify(good.json));
  const statusValue = await api("/api/settings/tiktok");
  const con = statusValue.json?.connection;
  ok(
    "la conexión enseña la cuenta, el usuario sin arroba y solo la cola de la llave",
    con?.accountRef === ACCOUNT &&
      con?.username === "negocio.demo" &&
      con?.tokenLast4 === "demo" &&
      con?.status === "connected" &&
      con?.hasWebhookSecret === true,
    JSON.stringify(con)
  );
  const raw = JSON.stringify(statusValue.json);
  ok(
    "ni la llave ni el secreto salen en la respuesta",
    !raw.includes("sk_llave-de-zernio-demo") && !raw.includes(SECRET)
  );

  console.log("\n== AC15: la URL del webhook ==");
  const wh = (await api("/api/settings/webhook")).json;
  ok(
    "tiktokUrl es la de este canal",
    typeof wh?.tiktokUrl === "string" &&
      wh.tiktokUrl.endsWith(`/api/webhooks/tiktok/${VERIFY_TOKEN}`),
    String(wh?.tiktokUrl).replace(VERIFY_TOKEN, "<token>")
  );
  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(
    "/api/health lista el canal",
    health?.features?.channels?.includes("tiktok"),
    JSON.stringify(health?.features)
  );
}

// ---------------------------------------------------------------------------
// Historias 1 y 2 — Recibir y responder
// ---------------------------------------------------------------------------

async function receiveAndAnswer() {
  console.log("\n== AC2: las dos capas del webhook ==");
  const nameValue = `Tania TikTok ${BRAND}`;
  const sender = `tt-user-${RUN}`;
  const thread = `zconv-tt-${RUN}`;
  const textValue = `hola, ¿tienen envíos? ${BRAND}`;
  const first = event({ sender, name: nameValue, user: "tania.tt", text: textValue, thread: thread });

  ok(
    "segmento de la URL equivocado → 404",
    (await deliver(first, { token: "no-es-el-token-de-esta-instancia" })) === 404
  );
  ok(
    "firma inválida → 401",
    (await deliver(first, { signature: "0".repeat(64) })) === 401
  );
  await sleep(1200);
  ok(
    "y nada de eso llegó a la bandeja",
    !(await conversations()).some((c) => c.contact.name === nameValue)
  );

  console.log("\n== AC1: un DM de TikTok entra a la bandeja ==");
  ok("firma válida → 200", (await deliver(first)) === 200);
  const conv = await convDe(nameValue);
  ok("la conversación aparece con el nombre del perfil", Boolean(conv));
  if (!conv) return null;
  ok("es del canal TikTok", conv.channel === "tiktok", conv.channel);
  const inbound = (await messagesOf(conv.id)).filter((m) => m.direction === "in");
  ok(
    "con el texto del cliente",
    inbound.length === 1 && inbound[0].text === textValue,
    JSON.stringify(inbound.map((m) => m.text))
  );

  if (BOT_KEY.length >= 16) {
    const ctx = await bot(`/api/bot/context?conversationId=${conv.id}`);
    const identity = ctx.json?.contact?.identity ?? ctx.json?.contact?.waIdentity;
    ok("la identidad del contacto es tt:<id>", identity === `tt:${sender}`, String(identity));
    ok(
      "y el contexto da la ventana de TikTok: abierta y con más de 24 h por delante",
      ctx.json?.conversation?.windowOpen === true &&
        ctx.json?.conversation?.windowRemainingMs > 24 * HOUR,
      JSON.stringify(ctx.json?.conversation)
    );
  } else {
    console.log("  SKIP identidad y ventana por /api/bot/context: sin BOT_API_KEY");
  }

  console.log("\n== AC3: el mismo mensaje entregado dos veces no se duplica ==");
  ok("la reentrega responde 200", (await deliver(first)) === 200);
  await sleep(1200);
  ok(
    "sigue habiendo un solo entrante",
    (await messagesOf(conv.id)).filter((m) => m.direction === "in").length === 1
  );

  console.log("\n== AC8: el agente incluido contesta por TikTok ==");
  const response = await agentResponse(conv.id, textValue);
  ok("hay una respuesta del agente en la conversación", Boolean(response));
  ok(
    "nace enviada: TikTok no manda acuses",
    response?.status === "sent",
    String(response?.status)
  );
  const viaZernio = await sentByZernio(thread);
  ok(
    "Zernio la recibió en la conversación de ese cliente, con la cuenta",
    viaZernio.length === 1 &&
      viaZernio[0].accountId === ACCOUNT &&
      viaZernio[0].message === response?.text &&
      !viaZernio[0].messageTag,
    JSON.stringify(viaZernio)
  );

  console.log("\n== AC7: el operador contesta desde la bandeja ==");
  const manual = await byHand(conv.id, `Sí, a todo el país ${BRAND}`);
  ok("el envío responde bien", manual.res.ok, `${manual.res.status} ${JSON.stringify(manual.json)}`);
  ok(
    "y llegó a Zernio",
    (await sentByZernio(thread)).some((m) => m.message === `Sí, a todo el país ${BRAND}`)
  );

  return { conv, thread: thread, sender, name: nameValue };
}

// ---------------------------------------------------------------------------
// Historia 3 — Los límites de TikTok
// ---------------------------------------------------------------------------

async function limits({ conv, thread: thread, sender, name: nameValue }) {
  console.log("\n== AC10: diez mensajes desde el último entrante, y el undécimo no sale ==");
  // Ya salieron dos: la respuesta del agente y la del operador.
  let accepted = 0;
  for (let i = 3; i <= 10; i++) {
    const r = await byHand(conv.id, `mensaje ${i} de 10 ${BRAND}`);
    if (r.res.ok) accepted++;
  }
  ok("los mensajes 3 al 10 salen", accepted === 8, `${accepted} de 8`);
  ok("Zernio lleva diez", (await sentByZernio(thread)).length === 10, String((await sentByZernio(thread)).length));

  const once = await byHand(conv.id, `el undécimo ${BRAND}`);
  ok(
    "el undécimo → 409 message_limit",
    once.res.status === 409 && once.json?.error?.code === "message_limit",
    `${once.res.status} ${JSON.stringify(once.json)}`
  );
  ok(
    "con un texto que dice qué pasa y qué lo arregla",
    /10 mensajes/.test(once.json?.error?.message ?? "") &&
      /vuelva a escribir/.test(once.json?.error?.message ?? ""),
    once.json?.error?.message
  );
  ok(
    "y no llegó a Zernio ni quedó en la conversación",
    (await sentByZernio(thread)).length === 10 &&
      !(await messagesOf(conv.id)).some((m) => m.text === `el undécimo ${BRAND}`)
  );
  if (BOT_KEY.length >= 16) {
    const byBot = await bot("/api/bot/messages", {
      method: "POST",
      body: JSON.stringify({ conversationId: conv.id, text: `el undécimo, por el bot ${BRAND}` }),
    });
    ok(
      "por /api/bot/messages, el mismo 409 message_limit",
      byBot.res.status === 409 && byBot.json?.error?.code === "message_limit",
      `${byBot.res.status} ${JSON.stringify(byBot.json)}`
    );
  }

  console.log("\n== AC9: un texto de más de 6,000 caracteres no sale ==");
  // Con el tope alcanzado no se puede probar aquí: va tras el siguiente entrante.

  console.log("\n== AC11: cuando el cliente vuelve a escribir, la cuenta empieza de nuevo ==");
  const other = `¿y cuánto tarda? ${BRAND}`;
  await deliver(event({ sender, name: nameValue, user: "tania.tt", text: other, thread: thread }));
  const response = await agentResponse(conv.id, other);
  ok("el agente contesta el mensaje nuevo", Boolean(response));
  const free = await byHand(conv.id, `De dos a tres días ${BRAND}`);
  ok("y el operador vuelve a poder escribir", free.res.ok, `${free.res.status} ${JSON.stringify(free.json)}`);

  const before = (await sentByZernio(thread)).length;
  const long = await byHand(conv.id, "a".repeat(6001));
  ok(
    "6,001 caracteres → rechazado con el límite dicho",
    long.res.status === 422 && /6,000 caracteres/.test(long.json?.error?.message ?? ""),
    `${long.res.status} ${long.json?.error?.message}`
  );
  ok("sin llamar a Zernio", (await sentByZernio(thread)).length === before);
  const exact = await byHand(conv.id, "é".repeat(6000));
  ok(
    "6,000 caracteres con acento sí salen: se cuentan caracteres, no bytes",
    exact.res.ok,
    `${exact.res.status} ${exact.json?.error?.message ?? ""}`
  );
  if (BOT_KEY.length >= 16) {
    const byBot = await bot("/api/bot/messages", {
      method: "POST",
      body: JSON.stringify({ conversationId: conv.id, text: "a".repeat(6001) }),
    });
    ok(
      "por /api/bot/messages, 6,001 caracteres → 422 invalid_body",
      byBot.res.status === 422 && byBot.json?.error?.code === "invalid_body",
      `${byBot.res.status} ${JSON.stringify(byBot.json?.error?.code)}`
    );
  }
}

async function window() {
  console.log("\n== AC12: la ventana es de 48 horas, no de 24 ==");
  const a30 = `Uriel Treinta ${BRAND}`;
  const hilo30 = `zconv-tt-30-${RUN}`;
  await deliver(
    event({
      sender: `tt-30-${RUN}`,
      name: a30,
      text: `escribí hace 30 horas ${BRAND}`,
      thread: hilo30,
      sentAt: new Date(Date.now() - 30 * HOUR),
    })
  );
  const conv30 = await convDe(a30);
  ok(
    "a las 30 horas la ventana sigue abierta",
    conv30?.windowOpen === true && conv30?.windowRemainingMs > 17 * HOUR,
    JSON.stringify({ open: conv30?.windowOpen, remaining: conv30?.windowRemainingMs })
  );
  if (conv30) {
    const r = await byHand(conv30.id, `todavía a tiempo ${BRAND}`);
    ok("y se puede contestar", r.res.ok, `${r.res.status} ${JSON.stringify(r.json)}`);
  }

  const a49 = `Vera Cuarentaynueve ${BRAND}`;
  const hilo49 = `zconv-tt-49-${RUN}`;
  await deliver(
    event({
      sender: `tt-49-${RUN}`,
      name: a49,
      text: `escribí hace 49 horas ${BRAND}`,
      thread: hilo49,
      sentAt: new Date(Date.now() - 49 * HOUR),
    })
  );
  const conv49 = await convDe(a49);
  ok("a las 49 horas está cerrada", conv49?.windowOpen === false, String(conv49?.windowOpen));
  if (!conv49) return;
  const r = await byHand(conv49.id, `ya tarde ${BRAND}`);
  ok(
    "contestar → 409 window_closed",
    r.res.status === 409 && r.json?.error?.code === "window_closed",
    `${r.res.status} ${JSON.stringify(r.json)}`
  );
  ok(
    "con un texto que dice que TikTok no permite reabrir",
    /TikTok/.test(r.json?.error?.message ?? "") && /no permite reabrirla/.test(r.json?.error?.message ?? ""),
    r.json?.error?.message
  );
  await sleep(COALESCE + 3000);
  ok("y nada salió por Zernio para esa conversación", (await sentByZernio(hilo49)).length === 0);
}

// ---------------------------------------------------------------------------
// Historia 1 — Lo que se descarta
// ---------------------------------------------------------------------------

async function discards() {
  console.log("\n== AC4: lo que no es un DM de la cuenta conectada se descarta ==");
  const total = (await conversations()).length;
  const base = { sender: `tt-x-${RUN}`, name: `No Debe Entrar ${BRAND}`, text: `x ${BRAND}`, thread: `zconv-x-${RUN}` };

  // Otra cuenta: su secreto no es el nuestro, así que ni siquiera se conoce
  // con qué validar; se acepta la entrega y se descarta al enrutar.
  const fromOtherAccount = event({
    ...base,
    over: { account: { id: `otra-cuenta-${RUN}`, accountId: `otra-cuenta-${RUN}`, platform: "tiktok" } },
  });
  ok("otra cuenta → 200", (await deliver(fromOtherAccount, { signature: "" })) === 200);
  ok(
    "otra plataforma (X) → 200",
    (await deliver(
      event({
        ...base,
        message: { platform: "twitter" },
        over: { account: { id: ACCOUNT, accountId: ACCOUNT, platform: "twitter" } },
      })
    )) === 200
  );
  ok("un saliente → 200", (await deliver(event({ ...base, message: { direction: "outgoing" } }))) === 200);
  ok("otro tipo de evento → 200", (await deliver(event({ ...base, over: { event: "message.sent" } }))) === 200);
  ok("un cuerpo que no es JSON → 200", (await deliver("esto no es json")) === 200);
  await sleep(2000);
  const now = await conversations();
  ok(
    "ninguno creó una conversación",
    now.length === total && !now.some((c) => c.contact.name === base.name),
    `${total} → ${now.length}`
  );

  console.log("\n== AC6: un adjunto sin texto entra con su tipo ==");
  const nameValue = `Wendy Foto ${BRAND}`;
  await deliver(
    event({
      sender: `tt-foto-${RUN}`,
      name: nameValue,
      thread: `zconv-foto-${RUN}`,
      message: { attachments: [{ type: "image", url: "https://cdn.example/x.jpg" }] },
    })
  );
  const conv = await convDe(nameValue);
  const m = conv ? (await messagesOf(conv.id)).find((x) => x.direction === "in") : null;
  ok("entra como imagen, sin texto", m?.type === "image" && !m?.text, JSON.stringify(m && { type: m.type, text: m.text }));
}

async function routing() {
  console.log("\n== AC5: el mismo evento por la URL de otro canal entra igual a TikTok ==");
  if (!CHANNELS.includes("instagram")) {
    console.log("  SKIP: CHANNELS no incluye instagram");
    return;
  }
  const nameValue = `Ximena Reparto ${BRAND}`;
  const status = await deliver(
    event({
      sender: `tt-reparto-${RUN}`,
      name: nameValue,
      text: `llegué por la URL de Instagram ${BRAND}`,
      thread: `zconv-reparto-${RUN}`,
    }),
    { ruta: "ig" }
  );
  ok("la URL de Instagram acepta el evento de TikTok", status === 200, String(status));
  const conv = await convDe(nameValue);
  ok("y entra como conversación de TikTok", conv?.channel === "tiktok", String(conv?.channel));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
