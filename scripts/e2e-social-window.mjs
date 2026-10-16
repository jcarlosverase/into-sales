/**
 * Self-test E2E de comportamiento — 024: texto del agente en redes y ventana
 * de atención humana.
 *
 * Conduce la app real con los simuladores: mete mensajes por el webhook como
 * lo haría Zernio (con la fecha que haga falta para envejecer la ventana),
 * contesta como cerebro (`/api/bot/messages`) y como persona (la bandeja), y
 * comprueba lo que salió hacia cada plataforma y lo que quedó en el hilo.
 *
 * Uso:
 *   1) app corriendo (`next dev`) sobre una base migrada, SIN
 *      BRAIN_DISPATCH_URL, con CHANNELS=whatsapp,instagram,messenger,tiktok,
 *      WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock, ZERNIO_BASE_URL →
 *      zernio-mock, OPENROUTER_BASE_URL → ai-mock con OPENROUTER_API_TOKEN y
 *      OPENROUTER_MODEL, BOT_API_KEY y AGENT_COALESCE_MS corta (1500).
 *   2) node --env-file=.env scripts/e2e-social-window.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-ventana-social.md.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((c) => c.trim());
const RUN = Date.now().toString(36);
const BRAND = `#${RUN}`;
const SECRET = "secreto-del-webhook-de-zernio";
const KEY = "sk_llave-de-zernio-ventana";
const PN = "PN-E2E-1";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ACCOUNT = { ig: `ig-vs-${RUN}`, fb: `fb-vs-${RUN}`, tt: `tt-vs-${RUN}` };
const PLATFORM = { ig: "instagram", fb: "facebook", tt: "tiktok" };
const CHANNEL = { ig: "instagram", fb: "messenger", tt: "tiktok" };

// Lo que escribe una IA: formato de WhatsApp y Markdown mezclados.
const WITH_FORMAT = (m) =>
  `*Hola* ${m}\n**Horario:** de _9 a 6_\n- Martillos\n- ~Clavos~ agotados\nMira el [catálogo](https://tienda.mx/cat_2026)`;
const FLAT = (m) =>
  `Hola ${m}\nHorario: de 9 a 6\n• Martillos\n• Clavos agotados\nMira el catálogo: https://tienda.mx/cat_2026`;

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

let nEvent = 0;
/** Un `message.received` de Zernio; `hace` envejece el mensaje del cliente. */
async function inboundSocial(red, { sender, name: nameValue, text, ago: ago = 0 }) {
  nEvent++;
  const thread = `zconv-vs-${red}-${sender}`;
  const body = JSON.stringify({
    id: `evt-vs-${RUN}-${nEvent}`,
    event: "message.received",
    message: {
      id: `zmsg-vs-${RUN}-${nEvent}`,
      conversationId: thread,
      platform: PLATFORM[red],
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: sender, name: nameValue, username: null },
      sentAt: new Date(Date.now() - ago).toISOString(),
    },
    conversation: { id: thread },
    account: { id: ACCOUNT[red], accountId: ACCOUNT[red], platform: PLATFORM[red] },
  });
  const res = await fetch(`${BASE}/api/webhooks/ig/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", SECRET).update(body).digest("hex"),
    },
    body: body,
  });
  return { status: res.status, thread: thread };
}

let nWa = 0;
const inboundWa = (from, name, text) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.vs.${RUN}.${++nWa}`,
    }),
  });

const conversations = async () => (await api("/api/conversations")).json?.conversations ?? [];
// La ingesta corre tras responder el webhook y sella `lastInboundAt` al final:
// se espera a la conversación YA con su último entrante, que es de lo que
// depende la ventana.
const convDe = (nameValue) =>
  until(async () =>
    (await conversations()).find((c) => c.contact.name === nameValue && c.lastInboundAt !== null)
  );
const messagesOf = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
const sentByZernio = async (thread) =>
  ((await api("/api/dev/zernio-mock/_sent")).json?.sent ?? []).filter((m) => m.conversationId === thread);
const asBrain = (conversationId, text) =>
  bot("/api/bot/messages", { method: "POST", body: JSON.stringify({ conversationId, text }) });
const byHand = (conversationId, text) =>
  api(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
const agent = (enabled) =>
  api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled }) });

/** Abre una conversación social con un mensaje del cliente de hace `hace` ms. */
async function conversation(red, label, ago = 0) {
  const sender = `${red}-${label}-${RUN}`;
  const nameValue = `Cliente ${red} ${label} ${BRAND}`;
  const e = await inboundSocial(red, { sender, name: nameValue, text: `hola ${label} ${BRAND}`, ago: ago });
  const conv = e.status === 200 ? await convDe(nameValue) : null;
  return { conv, thread: e.thread, sender, name: nameValue, status: e.status };
}

// ---------------------------------------------------------------------------

async function main() {
  for (const c of ["instagram", "messenger", "tiktok"]) {
    if (!CHANNELS.includes(c)) {
      console.error(`CHANNELS no incluye \`${c}\`: arranca la app con los tres canales sociales.`);
      process.exit(1);
    }
  }
  if ((process.env.BRAIN_DISPATCH_URL ?? "").trim()) {
    console.error("La app tiene BRAIN_DISPATCH_URL: este guion necesita al agente incluido.");
    process.exit(1);
  }
  if (!BOT_KEY) {
    console.error("Falta BOT_API_KEY: el guion contesta como cerebro por /api/bot/messages.");
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
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));

  await api("/api/dev/zernio-mock/_reset", { method: "POST" });
  await api("/api/dev/zernio-mock/_accounts", {
    method: "POST",
    body: JSON.stringify({
      accounts: [
        { _id: ACCOUNT.ig, platform: "instagram", username: "negocio.ig", platformUserId: `1784${RUN}`, isActive: true, platformStatus: "active" },
        { _id: ACCOUNT.fb, platform: "facebook", displayName: "Negocio Demo", isActive: true, platformStatus: "active", metadata: { selectedPageId: `page-${RUN}`, selectedPageName: "Negocio Demo" } },
        { _id: ACCOUNT.tt, platform: "tiktok", username: "negocio.tt", isActive: true, platformStatus: "active", tiktokAccountType: "business" },
      ],
    }),
  });
  await api("/api/dev/zernio-mock/_webhooks", { method: "POST", body: JSON.stringify({ webhooks: [] }) });
  const connections = [];
  for (const [channel, body] of [
    ["instagram", { source: "zernio", token: KEY, webhookSecret: SECRET }],
    ["messenger", { source: "zernio", token: KEY, webhookSecret: SECRET }],
    ["tiktok", { token: KEY, webhookSecret: SECRET }],
  ]) {
    connections.push((await api(`/api/settings/${channel}`, { method: "PUT", body: JSON.stringify(body) })).res.ok);
  }
  ok("Instagram, Messenger y TikTok conectados por Zernio (simulador)", connections.every(Boolean), JSON.stringify(connections));
  const wa = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("WhatsApp conectado (wa-mock)", wa.res.ok, JSON.stringify(wa.json));
  // Apagado mientras el guion hace de cerebro: así solo sale lo que él manda.
  ok("agente incluido apagado para la primera parte", (await agent(false)).res.ok);

  await plainText();
  await humanWindow();
  await builtInAgent();

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// D1 — En redes, el texto de la IA sale plano
// ---------------------------------------------------------------------------

async function plainText() {
  console.log("\n== D1: el texto de la IA sale plano en redes ==");
  for (const red of ["ig", "fb", "tt"]) {
    const { conv, thread: thread } = await conversation(red, "formato");
    if (!conv) {
      ok(`${CHANNEL[red]}: la conversación se abrió`, false);
      continue;
    }
    const brand = `${red} ${BRAND}`;
    const r = await asBrain(conv.id, WITH_FORMAT(brand));
    ok(`${CHANNEL[red]}: el cerebro contesta → 200`, r.res.ok, `${r.res.status} ${JSON.stringify(r.json)}`);
    const left = (await sentByZernio(thread)).at(-1);
    ok(
      `${CHANNEL[red]}: a la plataforma llega sin asteriscos, con viñetas y el enlace legible`,
      left?.message === FLAT(brand),
      JSON.stringify(left?.message)
    );
    const saved = (await messagesOf(conv.id)).filter((m) => m.direction === "out").at(-1);
    ok(
      `${CHANNEL[red]}: en el hilo queda lo mismo que leyó el cliente, marcado como IA`,
      saved?.text === FLAT(brand) && saved?.aiGenerated === true,
      JSON.stringify(saved?.text)
    );
  }

  const { conv: convIg, thread: threadIg } = await conversation("ig", "operador");
  const manualText = `*esto* lo escribí _yo_ ${BRAND}`;
  const m = await byHand(convIg.id, manualText);
  ok("Instagram: lo que escribe una persona sale → 200", m.res.ok, `${m.res.status} ${JSON.stringify(m.json)}`);
  ok(
    "y sale tal cual lo escribió, con sus asteriscos",
    (await sentByZernio(threadIg)).at(-1)?.message === manualText,
    JSON.stringify((await sentByZernio(threadIg)).at(-1)?.message)
  );

  const nameWa = `Cliente wa formato ${BRAND}`;
  const tel = `52155${String(Date.now() % 1_000_000).padStart(6, "0")}77`;
  await inboundWa(tel, nameWa, `hola por whatsapp ${BRAND}`);
  const convWa = await convDe(nameWa);
  const brandWa = `wa ${BRAND}`;
  const rWa = await asBrain(convWa.id, WITH_FORMAT(brandWa));
  ok("WhatsApp: el cerebro contesta → 200", rWa.res.ok, `${rWa.res.status} ${JSON.stringify(rWa.json)}`);
  const outbox = JSON.stringify((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []);
  ok(
    "WhatsApp: el texto sale con su formato, sin tocar",
    outbox.includes(JSON.stringify(WITH_FORMAT(brandWa)).slice(1, -1)),
    ""
  );
  const savedWa = (await messagesOf(convWa.id)).filter((x) => x.direction === "out").at(-1);
  ok("WhatsApp: y así queda en el hilo", savedWa?.text === WITH_FORMAT(brandWa), JSON.stringify(savedWa?.text));
}

// ---------------------------------------------------------------------------
// D2–D4 — La ventana de atención humana
// ---------------------------------------------------------------------------

async function humanWindow() {
  console.log("\n== D3: quién puede escribir pasadas 24 horas ==");
  for (const red of ["ig", "fb"]) {
    const channel = CHANNEL[red];

    // Dentro de las 24 horas: normal, sin etiqueta.
    const inside = await conversation(red, "23h", 23 * HOUR);
    ok(
      `${channel} a las 23 h: ventana abierta y sin atención humana en la bandeja`,
      inside.conv?.windowOpen === true && inside.conv?.humanWindow?.open === false,
      JSON.stringify({ w: inside.conv?.windowOpen, h: inside.conv?.humanWindow })
    );
    await byHand(inside.conv.id, `respuesta a tiempo ${BRAND}`);
    const withoutLabel = (await sentByZernio(inside.thread)).at(-1);
    ok(
      `${channel} a las 23 h: la respuesta sale sin etiqueta`,
      withoutLabel && !withoutLabel.messageTag,
      JSON.stringify(withoutLabel)
    );

    // Entre 24 horas y 7 días: solo una persona, con la etiqueta.
    const en = await conversation(red, "30h", 30 * HOUR);
    const h = en.conv?.humanWindow;
    ok(
      `${channel} a las 30 h: la bandeja dice atención humana y cuánto queda (~6 días)`,
      en.conv?.windowOpen === false &&
        h?.open === true &&
        h.remainingMs > 7 * DAY - 31 * HOUR &&
        h.remainingMs <= 7 * DAY - 30 * HOUR,
      JSON.stringify({ w: en.conv?.windowOpen, h })
    );
    const ia = await asBrain(en.conv.id, `respuesta automática ${BRAND}`);
    ok(
      `${channel} a las 30 h: la IA no puede → 409 window_closed que lo explica`,
      ia.res.status === 409 &&
        ia.json?.error?.code === "window_closed" &&
        ia.json?.error?.message?.includes("una persona"),
      `${ia.res.status} ${JSON.stringify(ia.json)}`
    );
    ok(`${channel} a las 30 h: y a la plataforma no salió nada`, (await sentByZernio(en.thread)).length === 0);
    const persona = await byHand(en.conv.id, `te contesto yo ${BRAND}`);
    ok(`${channel} a las 30 h: una persona sí → 200`, persona.res.ok, `${persona.res.status} ${JSON.stringify(persona.json)}`);
    const withLabel = (await sentByZernio(en.thread)).at(-1);
    ok(
      `${channel} a las 30 h: sale con la etiqueta de agente humano`,
      withLabel?.messagingType === "MESSAGE_TAG" && withLabel?.messageTag === "HUMAN_AGENT",
      JSON.stringify(withLabel)
    );
    const after = (await conversations()).find((c) => c.id === en.conv.id);
    ok(
      `${channel}: contestar no alarga el plazo (cuenta el último mensaje del cliente)`,
      after?.humanWindow?.open === true && after.humanWindow.remainingMs <= h.remainingMs,
      JSON.stringify(after?.humanWindow)
    );

    // Pasados 7 días: nadie.
    const outside = await conversation(red, "8d", 8 * DAY);
    ok(
      `${channel} a los 8 días: la bandeja la da por cerrada`,
      outside.conv?.windowOpen === false && outside.conv?.humanWindow?.open === false,
      JSON.stringify({ w: outside.conv?.windowOpen, h: outside.conv?.humanWindow })
    );
    const late = await byHand(outside.conv.id, `ya es tarde ${BRAND}`);
    ok(
      `${channel} a los 8 días: ni una persona → 409 window_closed que dice 7 días`,
      late.res.status === 409 &&
        late.json?.error?.code === "window_closed" &&
        late.json?.error?.message?.includes("7 días"),
      `${late.res.status} ${JSON.stringify(late.json)}`
    );
    const slowAi = await asBrain(outside.conv.id, `ya es tarde ${BRAND}`);
    ok(`${channel} a los 8 días: ni la IA → 409`, slowAi.res.status === 409, String(slowAi.res.status));
    ok(`${channel} a los 8 días: a la plataforma no salió nada`, (await sentByZernio(outside.thread)).length === 0);

    // El cliente vuelve a escribir: todo se abre otra vez.
    await inboundSocial(red, { sender: outside.sender, name: outside.name, text: `ya volví ${BRAND}` });
    const reopened = await until(async () => {
      const c = (await conversations()).find((x) => x.id === outside.conv.id);
      return c?.windowOpen ? c : null;
    });
    ok(`${channel}: si el cliente vuelve a escribir, la ventana se reabre`, Boolean(reopened));
    const again = await asBrain(outside.conv.id, `bienvenido de vuelta ${BRAND}`);
    ok(`${channel}: y la IA puede contestar de nuevo`, again.res.ok, `${again.res.status} ${JSON.stringify(again.json)}`);
  }

  console.log("\n== Los canales sin extensión no cambian ==");
  const tt = await conversation("tt", "30h", 30 * HOUR);
  ok(
    "TikTok no tiene atención humana: su ventana de 48 h sigue abierta a las 30",
    tt.conv?.humanWindow === null && tt.conv?.windowOpen === true,
    JSON.stringify({ w: tt.conv?.windowOpen, h: tt.conv?.humanWindow })
  );
  const ttIa = await asBrain(tt.conv.id, `hola desde la IA ${BRAND}`);
  ok("y ahí la IA sí contesta → 200", ttIa.res.ok, `${ttIa.res.status} ${JSON.stringify(ttIa.json)}`);
  const convWa = (await conversations()).find((c) => c.channel === "whatsapp");
  ok("WhatsApp tampoco la tiene", convWa?.humanWindow === null, JSON.stringify(convWa?.humanWindow));
}

// ---------------------------------------------------------------------------
// El agente incluido también sale plano
// ---------------------------------------------------------------------------

async function builtInAgent() {
  console.log("\n== El agente incluido contesta plano en redes ==");
  ok("agente incluido encendido", (await agent(true)).res.ok);
  const sender = `ig-agente-${RUN}`;
  const nameValue = `Cliente ig agente ${BRAND}`;
  // El simulador de IA repite lo que dijo el cliente: si el cliente manda
  // asteriscos, la respuesta del agente los trae.
  const said = `quiero el *martillo* de **bola** ${BRAND}`;
  const e = await inboundSocial("ig", { sender, name: nameValue, text: said });
  const conv = e.status === 200 ? await convDe(nameValue) : null;
  const response = await until(
    async () => (await messagesOf(conv.id)).find((m) => m.direction === "out" && m.aiGenerated),
    COALESCE + 15000
  );
  ok("el agente contestó", Boolean(response), "sin respuesta del agente");
  if (!response) return;
  ok(
    "su respuesta repite al cliente pero sin las marcas",
    response.text.includes(`quiero el martillo de bola ${BRAND}`) && !/\*/.test(response.text),
    JSON.stringify(response.text)
  );
  const left = (await sentByZernio(e.thread)).at(-1);
  ok("y así llegó a Instagram", left?.message === response.text && !left.messageTag, JSON.stringify(left));
  await agent(false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
