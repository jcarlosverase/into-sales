/**
 * Self-test E2E de comportamiento — 023: Ajustes → Canales y arreglos de Zernio.
 *
 * Conduce la app real con el simulador de Zernio: conecta Instagram, Messenger
 * y TikTok como lo haría el propietario desde las pantallas, y comprueba que
 * la cuenta se resuelve contra la llave, que el webhook queda dado de alta y
 * limitado a las cuentas, que la firma se exige con el secreto que tenga
 * Zernio y que la pantalla de estado dice la verdad.
 *
 * Uso:
 *   1) app corriendo (`next dev`) sobre una base migrada, con CHANNELS que
 *      incluya `instagram`, `messenger` y `tiktok`, WA_MOCK_ENABLED=true y
 *      ZERNIO_BASE_URL → zernio-mock.
 *   2) node --env-file=.env scripts/e2e-channels.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-channels.md.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((c) => c.trim());
const RUN = Date.now().toString(36);
/** Marca de esta corrida: el arnés se puede repetir sobre la misma base. */
const BRAND = `#${RUN}`;
const KEY = "sk_llave-de-zernio-canales";

// Un perfil de Zernio con sus tres redes, como el real.
const PROFILE = `perfil-${RUN}`;
const IG = `ig-${RUN}`;
const FB = `fb-${RUN}`;
const TT = `tt-${RUN}`;
const account = {
  ig: (over = {}) => ({
    _id: IG,
    platform: "instagram",
    username: "negocio.ig",
    platformUserId: `1784${RUN}`,
    profileId: { _id: PROFILE },
    isActive: true,
    platformStatus: "active",
    ...over,
  }),
  fb: (over = {}) => ({
    _id: FB,
    platform: "facebook",
    username: "negocio",
    displayName: "Negocio Demo",
    profileId: { _id: PROFILE },
    isActive: true,
    platformStatus: "active",
    metadata: { selectedPageId: `page-${RUN}`, selectedPageName: "Negocio Demo" },
    ...over,
  }),
  tt: (over = {}) => ({
    _id: TT,
    platform: "tiktok",
    username: "negocio.tt",
    profileId: { _id: PROFILE },
    isActive: true,
    platformStatus: "active",
    tiktokAccountType: "personal",
    ...over,
  }),
};

let cookie = "";
let failures = 0;
let checks = 0;
let baseUsed = false;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** `jar` aparte para actuar como otra persona sin perder la sesión del dueño. */
async function api(path, opts = {}, jar = null) {
  const actual = jar ? jar.cookie : cookie;
  const res = await fetch(`${BASE}${path}`, {
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
// El simulador de Zernio
// ---------------------------------------------------------------------------

const mock = (route, body) =>
  api(`/api/dev/zernio-mock/${route}`, { method: "POST", body: JSON.stringify(body ?? {}) });
const seed = (accounts) => mock("_accounts", { accounts });
const setWebhooks = (webhooks) => mock("_webhooks", { webhooks });
const drop = (routes) => mock("_down", { routes });
const mockStatus = async () => (await api("/api/dev/zernio-mock/_state")).json ?? {};
/** Los webhooks del simulador que apuntan a esta instancia. */
const webhooksHere = async () =>
  ((await mockStatus()).webhooks ?? []).filter((w) => w.url.includes(`/${VERIFY_TOKEN}`));

const PLATFORM = { ig: "instagram", fb: "facebook", tt: "tiktok" };
let nEvent = 0;
/** Un `message.received` con la forma de la documentación de Zernio. */
function event(red, { accountId: accountId, profile: profile, sender, name: nameValue, text }) {
  nEvent++;
  return {
    id: `evt-can-${RUN}-${nEvent}`,
    event: "message.received",
    message: {
      id: `zmsg-can-${RUN}-${nEvent}`,
      conversationId: `zconv-${red}-${sender}`,
      platform: PLATFORM[red],
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: sender, name: nameValue, username: null },
      sentAt: new Date().toISOString(),
    },
    conversation: { id: `zconv-${red}-${sender}` },
    account: {
      id: accountId,
      accountId: accountId,
      platform: PLATFORM[red],
      ...(profile ? { profileId: profile } : {}),
    },
  };
}

/** Entrega un evento al webhook. `firma: null` = sin cabecera de firma. */
async function deliver(payload, { ruta: route = "ig", secret: secret, signature: signature } = {}) {
  const body = JSON.stringify(payload);
  const value =
    signature !== undefined
      ? signature
      : secret
        ? createHmac("sha256", secret).update(body).digest("hex")
        : null;
  const res = await fetch(`${BASE}/api/webhooks/${route}/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(value ? { "x-zernio-signature": value } : {}),
    },
    body: body,
  });
  return res.status;
}

const conversations = async () => (await api("/api/conversations")).json?.conversations ?? [];
const convDe = (nameValue, ms) =>
  until(async () => (await conversations()).find((c) => c.contact.name === nameValue), ms);

const connect = (channel, body, jar) =>
  api(`/api/settings/${channel}`, { method: "PUT", body: JSON.stringify(body) }, jar);
const connection = async (channel) => (await api(`/api/settings/${channel}`)).json?.connection ?? null;
const status = async (jar) => (await api("/api/settings/channels", {}, jar)).json ?? {};
/**
 * Las cuentas que la organización tiene conectadas por Zernio AHORA. En una
 * base recién creada es solo lo que este guion va conectando; al repetirlo
 * sobre la misma base quedan además las de la corrida anterior.
 */
async function connectedAccounts() {
  const refs = [];
  for (const channel of ["instagram", "messenger", "tiktok"]) {
    const c = await connection(channel);
    if (c?.accountRef && (c.source ?? "zernio") === "zernio") refs.push(c.accountRef);
  }
  // El webhook solo lleva las que la llave ve: una conexión que dejó otra
  // corrida, con una cuenta que el simulador ya no tiene, no cuenta.
  const seenOnes = new Set(((await mockStatus()).accounts ?? []).map((a) => a._id));
  return refs.filter((r) => seenOnes.has(r)).sort();
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const row = (e, channel) => (e.channels ?? []).find((c) => c.channel === channel);

// ---------------------------------------------------------------------------

async function main() {
  for (const c of ["instagram", "messenger", "tiktok"]) {
    if (!CHANNELS.includes(c)) {
      console.error(`CHANNELS no incluye \`${c}\`: arranca la app con los tres canales sociales.`);
      process.exit(1);
    }
  }
  if (!(process.env.ZERNIO_BASE_URL ?? "").includes("/api/dev/zernio-mock")) {
    console.error("ZERNIO_BASE_URL no apunta al zernio-mock: este guion no habla con la API real.");
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
  await mock("_reset");
  await seed([account.ig(), account.fb(), account.tt()]);
  await setWebhooks([]);
  // ¿La base ya traía conexiones de otra corrida? Entonces ya hay un secreto
  // guardado y el CRM lo reutiliza: no se genera uno nuevo.
  for (const channel of ["instagram", "messenger", "tiktok"]) {
    if (await connection(channel)) baseUsed = true;
  }

  await resolveAccount();
  await ownerOnly();
  await theWebhook();
  const secret = await signatureValue();
  if (secret) {
    await selfHealing(secret);
    await statusScreen(secret);
  }

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// D1 — La cuenta se resuelve contra Zernio
// ---------------------------------------------------------------------------

async function resolveAccount() {
  console.log("\n== D1: la cuenta se resuelve contra la llave ==");
  const bad = await connect("instagram", { source: "zernio", token: "sk_llave-invalid" });
  ok(
    "una llave que Zernio rechaza → 422 invalid_token",
    bad.res.status === 422 && bad.json?.error?.code === "invalid_token",
    `${bad.res.status} ${JSON.stringify(bad.json)}`
  );

  const alone = await connect("instagram", { source: "zernio", token: KEY });
  ok(
    "sin accountId y con una sola cuenta de Instagram → se toma esa",
    alone.res.ok && alone.json?.accountRef === IG && alone.json?.accountName === "@negocio.ig",
    `${alone.res.status} ${JSON.stringify(alone.json)}`
  );
  let con = await connection("instagram");
  ok(
    "la conexión guarda la cuenta, el usuario y el id de Instagram que da Zernio",
    con?.source === "zernio" &&
      con?.accountRef === IG &&
      con?.username === "negocio.ig" &&
      con?.igUserId === `1784${RUN}` &&
      con?.tokenLast4 === "ales",
    JSON.stringify(con)
  );

  const byProfile = await connect("instagram", {
    source: "zernio",
    accountRef: PROFILE,
    token: KEY,
  });
  ok(
    "con el id del PERFIL → se guarda el de la cuenta",
    byProfile.res.ok && byProfile.json?.accountRef === IG,
    `${byProfile.res.status} ${JSON.stringify(byProfile.json)}`
  );

  const fromOtherNetwork = await connect("instagram", { source: "zernio", accountRef: FB, token: KEY });
  ok(
    "con la cuenta de Facebook → 422 unknown_account que dice cuál sirve",
    fromOtherNetwork.res.status === 422 &&
      fromOtherNetwork.json?.error?.code === "unknown_account" &&
      fromOtherNetwork.json?.error?.message?.includes(IG) &&
      fromOtherNetwork.json?.error?.details?.accounts?.[0]?.id === IG,
    `${fromOtherNetwork.res.status} ${JSON.stringify(fromOtherNetwork.json)}`
  );
  const madeUp = await connect("instagram", {
    source: "zernio",
    accountRef: "no-existe",
    token: KEY,
  });
  ok(
    "con un id que no existe → 422 unknown_account",
    madeUp.res.status === 422 && madeUp.json?.error?.code === "unknown_account",
    `${madeUp.res.status} ${JSON.stringify(madeUp.json)}`
  );
  con = await connection("instagram");
  ok("y la conexión buena sigue intacta", con?.accountRef === IG, JSON.stringify(con));

  await seed([account.ig(), account.ig({ _id: `ig2-${RUN}`, username: "cliente.ig" }), account.fb(), account.tt()]);
  const several = await connect("instagram", { source: "zernio", token: KEY });
  const candidates = several.json?.error?.details?.accounts ?? [];
  ok(
    "con dos cuentas de Instagram en la llave → 422 choose_account con las dos",
    several.res.status === 422 &&
      several.json?.error?.code === "choose_account" &&
      candidates.length === 2 &&
      candidates.some((c) => c.id === IG && c.name === "@negocio.ig") &&
      candidates.some((c) => c.name === "@cliente.ig"),
    `${several.res.status} ${JSON.stringify(several.json)}`
  );
  const chosen = await connect("instagram", { source: "zernio", accountRef: IG, token: KEY });
  ok("y eligiendo una → 200", chosen.res.ok && chosen.json?.accountRef === IG, JSON.stringify(chosen.json));
  await seed([account.ig(), account.fb(), account.tt()]);

  await drop(["accounts"]);
  const down = await connect("instagram", { source: "zernio", token: KEY });
  ok(
    "con Zernio caído → 503 platform_unavailable, no «llave inválida»",
    down.res.status === 503 && down.json?.error?.code === "platform_unavailable",
    `${down.res.status} ${JSON.stringify(down.json)}`
  );
  await drop([]);

  const withoutId = await connect("instagram", { source: "meta", token: "token-meta" });
  ok(
    "con una app propia de Meta el ID de la cuenta sigue siendo obligatorio → 422",
    withoutId.res.status === 422,
    String(withoutId.res.status)
  );
}

// ---------------------------------------------------------------------------
// D7 — Conectar es cosa del propietario
// ---------------------------------------------------------------------------

async function ownerOnly() {
  console.log("\n== D7: solo el propietario conecta ==");
  const emailValue = `equipo-${RUN}@vocero.test`;
  const key = "password-equipo-123";
  const high = await api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "Equipo E2E", email: emailValue, password: key }),
  });
  ok("el propietario da de alta a alguien de su equipo", high.res.status === 201, JSON.stringify(high.json));

  const jar = { cookie: "" };
  const enters = await api(
    "/api/auth/sign-in/email",
    { method: "POST", body: JSON.stringify({ email: emailValue, password: key }) },
    jar
  );
  ok("esa persona inicia sesión", enters.res.ok, JSON.stringify(enters.json));

  for (const [channel, body] of [
    ["instagram", { source: "zernio", token: KEY }],
    ["messenger", { source: "zernio", token: KEY }],
    ["tiktok", { token: KEY }],
  ]) {
    const r = await connect(channel, body, jar);
    ok(`${channel}: quien no es propietario → 403`, r.res.status === 403, String(r.res.status));
  }
  const repair = await api("/api/settings/channels", { method: "POST" }, jar);
  ok("tampoco puede cambiar el webhook → 403", repair.res.status === 403, String(repair.res.status));
  const ve = await status(jar);
  ok(
    "pero sí ve el estado, y la pantalla sabe que no puede cambiar nada",
    Array.isArray(ve.channels) && ve.canManage === false,
    JSON.stringify(ve).slice(0, 200)
  );
}

// ---------------------------------------------------------------------------
// D4 — El CRM da de alta su webhook en Zernio
// ---------------------------------------------------------------------------

async function theWebhook() {
  console.log("\n== D4: el webhook se da de alta solo, limitado a las cuentas ==");
  // Un webhook ajeno, de otra herramienta del negocio: no se toca.
  const foreign = {
    _id: `ajeno-${RUN}`,
    name: "otra-herramienta",
    url: "https://otra.ejemplo.com/hooks/zernio",
    secret: "secreto-ajeno",
    events: ["post.published"],
    isActive: true,
    accountIds: [],
    failureCount: 0,
    lastFiredAt: null,
  };
  await setWebhooks([foreign]);

  const ig = await connect("instagram", { source: "zernio", token: KEY });
  ok(
    "al conectar Instagram, la respuesta dice que el webhook se creó",
    ig.res.ok && ig.json?.webhook?.ok === true && ig.json?.webhook?.created === true,
    JSON.stringify(ig.json?.webhook)
  );
  let here = await webhooksHere();
  const w = here[0];
  ok(
    "Zernio tiene UN webhook hacia esta instancia: activo, con message.received y solo las cuentas conectadas",
    here.length === 1 &&
      w.isActive === true &&
      JSON.stringify(w.events) === '["message.received"]' &&
      w.accountIds.includes(IG) &&
      same(w.accountIds, await connectedAccounts()) &&
      w.url === `${BASE}/api/webhooks/ig/${VERIFY_TOKEN}`,
    JSON.stringify(here).replace(VERIFY_TOKEN, "<segmento>")
  );
  ok(
    baseUsed
      ? "con secreto (la base ya traía uno guardado y se reutiliza)"
      : "con un secreto generado (48 caracteres hex), no vacío",
    baseUsed ? (w?.secret ?? "").length >= 16 : /^[0-9a-f]{48}$/.test(w?.secret ?? ""),
    `largo ${(w?.secret ?? "").length}`
  );
  ok(
    "la respuesta de guardar no trae la llave ni el secreto",
    !JSON.stringify(ig.json).includes(KEY) && !JSON.stringify(ig.json).includes(w?.secret ?? "∅"),
    ""
  );

  const fb = await connect("messenger", { source: "zernio", token: KEY });
  ok(
    "al conectar Messenger sin accountId se toma la página, con su nombre",
    fb.res.ok && fb.json?.accountRef === FB && fb.json?.pageName === "Negocio Demo",
    `${fb.res.status} ${JSON.stringify(fb.json)}`
  );
  const withFb = await connection("messenger");
  ok(
    "y se guarda el id de la página que da Zernio",
    withFb?.pageId === `page-${RUN}` && withFb?.pageName === "Negocio Demo",
    JSON.stringify(withFb)
  );
  here = await webhooksHere();
  ok(
    "el webhook es el MISMO, ahora también con la página y con el mismo secreto",
    here.length === 1 &&
      here[0]._id === w._id &&
      fb.json?.webhook?.created === false &&
      here[0].accountIds.includes(IG) &&
      here[0].accountIds.includes(FB) &&
      same(here[0].accountIds, await connectedAccounts()) &&
      here[0].secret === w.secret,
    JSON.stringify(here[0]?.accountIds)
  );

  const tt = await connect("tiktok", { token: KEY });
  ok(
    "TikTok personal se conecta, pero avisa que no recibirá mensajes hasta ser Business",
    tt.res.ok &&
      tt.json?.accountRef === TT &&
      tt.json?.health?.level === "error" &&
      tt.json?.health?.message?.includes("Business"),
    `${tt.res.status} ${JSON.stringify(tt.json)}`
  );
  here = await webhooksHere();
  ok(
    "y el webhook queda con las tres cuentas, ni una más",
    here.length === 1 && same(here[0].accountIds, [IG, FB, TT]),
    JSON.stringify(here[0]?.accountIds)
  );

  const other = ((await mockStatus()).webhooks ?? []).find((x) => x._id === foreign._id);
  ok(
    "el webhook ajeno sigue exactamente igual",
    JSON.stringify(other) === JSON.stringify(foreign),
    JSON.stringify(other)
  );

  // Zernio falla al registrar: la conexión se guarda igual y se dice.
  await drop(["webhooks/settings"]);
  const withFailure = await connect("instagram", { source: "zernio", token: KEY });
  ok(
    "si Zernio falla al registrar el webhook, la conexión se guarda y el fallo se dice",
    withFailure.res.ok &&
      withFailure.json?.webhook?.ok === false &&
      withFailure.json?.webhook?.code === "zernio_unavailable",
    `${withFailure.res.status} ${JSON.stringify(withFailure.json?.webhook)}`
  );
  await drop([]);
}

// ---------------------------------------------------------------------------
// D3 — Un secreto para todos los canales, y el de Zernio también vale
// ---------------------------------------------------------------------------

async function signatureValue() {
  console.log("\n== D3: la firma ==");
  const w = (await webhooksHere())[0];
  const S = w?.secret;
  if (!S) {
    ok("hay webhook con secreto para probar la firma", false);
    return null;
  }

  const nameIg = `Cliente IG ${BRAND}`;
  const e1 = event("ig", { accountId: IG, sender: `igs-${RUN}`, name: nameIg, text: `hola ig ${BRAND}` });
  ok("Instagram bien firmado → 200", (await deliver(e1, { secret: S })) === 200);
  const convIg = await convDe(nameIg);
  ok("y entra a la bandeja como Instagram", convIg?.channel === "instagram", JSON.stringify(convIg?.channel));

  const e2 = event("ig", { accountId: IG, sender: `igs-${RUN}`, name: nameIg, text: "no debe entrar" });
  ok("con la firma rota → 401", (await deliver(e2, { signature: "deadbeef" })) === 401);
  ok("sin firma → 401", (await deliver(e2, { signature: null })) === 401);

  // Un webhook, una URL, un secreto: Messenger llega por la URL de Instagram.
  const nameFb = `Cliente FB ${BRAND}`;
  const e3 = event("fb", { accountId: FB, sender: `fbs-${RUN}`, name: nameFb, text: `hola fb ${BRAND}` });
  ok("Messenger firmado con el MISMO secreto, por la misma URL → 200", (await deliver(e3, { secret: S })) === 200);
  const convFb = await convDe(nameFb);
  ok("y entra a la bandeja como Messenger", convFb?.channel === "messenger", JSON.stringify(convFb?.channel));

  // Reparar deja a Zernio con el secreto guardado y vacía lo que el CRM
  // recordaba de sus webhooks.
  const repair = await api("/api/settings/channels", { method: "POST" });
  ok("«reparar» actualiza el webhook → 200, sin crear otro", repair.res.ok && repair.json?.created === false, JSON.stringify(repair.json));
  ok("y Zernio firma con el secreto guardado", (await webhooksHere())[0]?.secret === S, "");

  // El secreto cambia en Zernio y el CRM no se entera: se lee de Zernio.
  const S2 = "secreto-cambiado-en-zernio";
  await setWebhooks(((await mockStatus()).webhooks ?? []).map((x) => (x._id === w._id ? { ...x, secret: S2 } : x)));
  const nameIg2 = `Cliente IG dos ${BRAND}`;
  const e4 = event("ig", { accountId: IG, sender: `igs2-${RUN}`, name: nameIg2, text: `hola otra vez ${BRAND}` });
  ok(
    "con el secreto que solo tiene Zernio → 200 (el CRM lo lee con la llave guardada)",
    (await deliver(e4, { secret: S2 })) === 200
  );
  ok("y el mensaje entra", Boolean(await convDe(nameIg2)));
  const reads = (await mockStatus()).hits?.["webhooks/settings"] ?? 0;
  const e5 = event("ig", { accountId: IG, sender: `igs2-${RUN}`, name: nameIg2, text: "segundo" });
  const e6 = event("ig", { accountId: IG, sender: `igs2-${RUN}`, name: nameIg2, text: "tercero" });
  await deliver(e5, { secret: S2 });
  await deliver(e6, { secret: S2 });
  const e7 = event("ig", { accountId: IG, sender: `igs2-${RUN}`, name: nameIg2, text: "ajeno" });
  ok("con un secreto que no es de nadie → 401", (await deliver(e7, { secret: "inventado" })) === 401);
  ok("otra vez → 401", (await deliver(e7, { signature: "deadbeef" })) === 401);
  ok(
    "ni las entregas buenas ni las firmas inválidas vuelven a preguntarle a Zernio (caché)",
    ((await mockStatus()).hits?.["webhooks/settings"] ?? 0) === reads,
    `${reads} → ${(await mockStatus()).hits?.["webhooks/settings"]}`
  );
  ok("y el secreto guardado sigue valiendo → 200", (await deliver(e7, { secret: S })) === 200);

  // Zernio caído y un secreto desconocido: no se abre. («Reparar» vacía lo
  // que el CRM recordaba y deja a Zernio con el secreto guardado.)
  await api("/api/settings/channels", { method: "POST" });
  const S3 = "otro-secreto-con-zernio-caido";
  await setWebhooks(((await mockStatus()).webhooks ?? []).map((x) => (x._id === w._id ? { ...x, secret: S3 } : x)));
  await drop(["webhooks/settings"]);
  const e8 = event("ig", { accountId: IG, sender: `igs2-${RUN}`, name: nameIg2, text: "con zernio caido" });
  ok("Zernio caído y firma con un secreto que el CRM no conoce → 401", (await deliver(e8, { secret: S3 })) === 401);
  ok("Zernio caído y firma con el secreto guardado → 200", (await deliver(e8, { secret: S })) === 200);
  await drop([]);
  await setWebhooks(((await mockStatus()).webhooks ?? []).map((x) => (x._id === w._id ? { ...x, secret: S } : x)));

  // Una cuenta que nadie conectó aquí: no hay contra qué comparar y no entra.
  const foreignName = `No Debe Entrar ${BRAND}`;
  const e9 = event("ig", { accountId: `ajena-${RUN}`, sender: `x-${RUN}`, name: foreignName, text: "x" });
  ok("un evento de una cuenta que no es de esta instancia → 200…", (await deliver(e9, { signature: "deadbeef" })) === 200);
  ok("…y no se ingiere nada", !(await convDe(foreignName, 2500)));

  return S;
}

// ---------------------------------------------------------------------------
// D2 — Una fila con el id del perfil se corrige sola
// ---------------------------------------------------------------------------

async function selfHealing(S) {
  console.log("\n== D2: una conexión guardada con el id del perfil se corrige sola ==");
  // Para llegar al estado de una instalación anterior a la 1.6: el simulador
  // dice que el id del perfil ES una página, y así se guarda tal cual.
  await seed([account.ig(), account.fb({ _id: PROFILE }), account.tt()]);
  const old = await connect("messenger", { source: "zernio", accountRef: PROFILE, token: KEY });
  ok("(preparación) la conexión de Messenger queda con el id del perfil", old.res.ok && (await connection("messenger"))?.accountRef === PROFILE, JSON.stringify(old.json));
  await seed([account.ig(), account.fb(), account.tt()]);

  const nameValue = `Cliente perfil ${BRAND}`;
  const e = event("fb", { accountId: FB, profile: PROFILE, sender: `fbp-${RUN}`, name: nameValue, text: `hola con perfil ${BRAND}` });
  ok("un evento sin firma válida no corrige nada → 401", (await deliver(e, { signature: "deadbeef" })) === 401);
  ok("la conexión sigue con el id del perfil", (await connection("messenger"))?.accountRef === PROFILE);

  ok("el mismo evento, bien firmado → 200", (await deliver(e, { secret: S })) === 200);
  ok("el mensaje entra a la bandeja", Boolean(await convDe(nameValue)));
  const healed = await until(async () => {
    const c = await connection("messenger");
    return c?.accountRef === FB ? c : null;
  }, 5000);
  ok("y la conexión queda con el id de la cuenta", Boolean(healed), JSON.stringify(await connection("messenger")));
  await api("/api/settings/channels", { method: "POST" });
}

// ---------------------------------------------------------------------------
// D5 — La pantalla de estado
// ---------------------------------------------------------------------------

async function statusScreen(S) {
  console.log("\n== D5: el estado de los canales ==");
  await seed([account.ig(), account.fb({ needsReconnection: true }), account.tt()]);
  let e = await status();
  ok(
    "una fila por canal encendido, en orden, con WhatsApp primero",
    JSON.stringify((e.channels ?? []).map((c) => c.channel)) ===
      JSON.stringify(["whatsapp", ...["instagram", "messenger", "tiktok"]]),
    JSON.stringify((e.channels ?? []).map((c) => c.channel))
  );
  ok("el propietario puede cambiar el webhook", e.canManage === true);

  const ig = row(e, "instagram");
  ok(
    "Instagram: conectado por Zernio, con su cuenta y su último mensaje",
    ig?.connected === true &&
      ig?.source === "zernio" &&
      ig?.account === "@negocio.ig" &&
      ig?.status === "connected" &&
      typeof ig?.lastInboundAt === "string" &&
      Date.now() - Date.parse(ig.lastInboundAt) < 10 * 60 * 1000,
    JSON.stringify(ig)
  );
  ok(
    "Instagram: cuenta y webhook sanos",
    ig?.health?.account?.level === "ok" && ig?.health?.webhook?.level === "ok",
    JSON.stringify(ig?.health)
  );
  const fb = row(e, "messenger");
  ok(
    "Messenger: la cuenta que Zernio marca para reconectar sale como error",
    fb?.health?.account?.level === "error" && fb?.health?.account?.message?.includes("reconectar"),
    JSON.stringify(fb?.health?.account)
  );
  const tt = row(e, "tiktok");
  ok(
    "TikTok: la cuenta personal sale como error y dice por qué",
    tt?.health?.account?.level === "error" && tt?.health?.account?.message?.includes("Business"),
    JSON.stringify(tt?.health?.account)
  );
  const wa = row(e, "whatsapp");
  ok("WhatsApp: tiene su fila, sin salud de Zernio", Boolean(wa) && wa.health === null, JSON.stringify(wa));
  const raw = JSON.stringify(e);
  ok(
    "el estado no trae la llave ni el secreto",
    !raw.includes(KEY) && !raw.includes(S) && !raw.includes(VERIFY_TOKEN),
    ""
  );

  const mine = (await webhooksHere())[0];
  const withMine = async (over) =>
    setWebhooks(((await mockStatus()).webhooks ?? []).map((x) => (x._id === mine._id ? { ...x, ...over } : x)));

  await withMine({ isActive: false });
  e = await status();
  ok(
    "webhook desactivado en Zernio → error en los tres canales",
    ["instagram", "messenger", "tiktok"].every(
      (c) => row(e, c)?.health?.webhook?.level === "error" && row(e, c)?.health?.webhook?.message?.includes("desactivado")
    ),
    JSON.stringify(row(e, "instagram")?.health?.webhook)
  );
  const r1 = await api("/api/settings/channels", { method: "POST" });
  ok("«reparar» lo reactiva sin crear otro", r1.res.ok && r1.json?.created === false && r1.json?.accounts === 3, JSON.stringify(r1.json));
  e = await status();
  ok("y vuelve a estar bien", row(e, "instagram")?.health?.webhook?.level === "ok", JSON.stringify(row(e, "instagram")?.health?.webhook));

  await withMine({ accountIds: [IG], failureCount: 4, lastFiredAt: new Date().toISOString() });
  e = await status();
  ok(
    "un webhook que no incluye la cuenta → error en esa y no en la que sí",
    row(e, "messenger")?.health?.webhook?.level === "error" &&
      row(e, "messenger")?.health?.webhook?.message?.includes("no incluye esta cuenta"),
    JSON.stringify(row(e, "messenger")?.health?.webhook)
  );
  ok(
    "y los fallos de entrega salen como aviso, con la hora del último disparo",
    row(e, "instagram")?.health?.webhook?.level === "warn" &&
      row(e, "instagram")?.health?.webhook?.failureCount === 4 &&
      typeof row(e, "instagram")?.health?.webhook?.lastFiredAt === "string",
    JSON.stringify(row(e, "instagram")?.health?.webhook)
  );

  // Sin webhook hacia aquí.
  await setWebhooks(((await mockStatus()).webhooks ?? []).filter((x) => x._id !== mine._id));
  e = await status();
  ok(
    "sin webhook hacia esta instancia → error que lo dice",
    row(e, "instagram")?.health?.webhook?.level === "error" &&
      row(e, "instagram")?.health?.webhook?.message?.includes("no tiene un webhook"),
    JSON.stringify(row(e, "instagram")?.health?.webhook)
  );
  const r2 = await api("/api/settings/channels", { method: "POST" });
  ok("«reparar» lo crea de nuevo, con las tres cuentas", r2.res.ok && r2.json?.created === true && r2.json?.accounts === 3, JSON.stringify(r2.json));
  const newOneValue = (await webhooksHere())[0];
  ok(
    "con el secreto que el CRM ya tenía: lo ya firmado sigue valiendo",
    newOneValue?.secret === S && newOneValue?.accountIds?.length === 3,
    `mismo secreto: ${newOneValue?.secret === S}`
  );

  await drop(["accounts"]);
  e = await status();
  ok(
    "con Zernio caído la pantalla carga igual y lo dice, sin inventar un «todo bien»",
    row(e, "instagram")?.connected === true &&
      row(e, "instagram")?.health?.account?.level === "warn" &&
      row(e, "instagram")?.health?.webhook?.level === "warn",
    JSON.stringify(row(e, "instagram")?.health)
  );
  await drop([]);

  // TikTok ya es Business: al reconectar deja de avisar.
  await seed([account.ig(), account.fb(), account.tt({ tiktokAccountType: "business" })]);
  const tt2 = await connect("tiktok", { token: KEY });
  ok("TikTok Business se conecta sin aviso", tt2.res.ok && tt2.json?.health?.level === "ok", JSON.stringify(tt2.json?.health));
  e = await status();
  ok(
    "y los tres canales quedan sanos",
    ["instagram", "messenger", "tiktok"].every(
      (c) => row(e, c)?.health?.account?.level === "ok" && row(e, c)?.health?.webhook?.level === "ok"
    ),
    JSON.stringify((e.channels ?? []).map((c) => [c.channel, c.health?.account?.level, c.health?.webhook?.level]))
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
