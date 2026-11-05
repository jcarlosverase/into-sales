/**
 * Self-test E2E — tarjeta de sellos, corte 1 (guion tests/e2e/us-stamp-card.md,
 * spec 1023).
 *
 * Con `STAMP_CARD` apagada comprueba que nada existe (AC1). Encendida conduce
 * la historia completa: programa (AC2), alta por WhatsApp sin turno de IA
 * (AC3), página pública a 360 px (AC4), sellos con idempotencia y freno
 * (AC5), canje (AC6), el QR del equipo con y sin sesión (AC7), el cartel
 * (AC13) y la ficha (AC14). Lo que dice la bandera lo lee de /api/health.
 *
 * Uso: node --env-file=.env scripts/e2e-stamp-card.mjs
 * Requiere: app corriendo (`next dev`) con WA_MOCK_ENABLED=true, el ai-mock
 * como proveedor (OPENROUTER_BASE_URL) y la BD migrada.
 */
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-SELLOS-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
const PHONE = `5199${Math.floor(1000000 + Math.random() * 8999999)}`;
const NAME = `Cliente${S}`;

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

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const req = ctx.request;
const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

console.log("== Setup ==");
const email = "e2e@intosales.test";
const password = "password-e2e-123";
let su = await req.post(`${BASE}/api/auth/sign-up/email`, { data: { email, password, name: "Operador E2E" } });
if (!su.ok()) su = await req.post(`${BASE}/api/auth/sign-in/email`, { data: { email, password } });
ok("registro o login del operador", su.ok());
const conn = await req.put(`${BASE}/api/settings/whatsapp`, { data: { wabaId: "WABA-SELLOS", phoneNumberId: PN, token: "tok-sellos" } });
ok("conexión WhatsApp guardada", conn.ok());
const health = await json(await req.get(`${BASE}/api/health`));
const enabled = health?.features?.stampCard === true;
console.log(`  · STAMP_CARD ${enabled ? "encendida" : "apagada"}`);

const outboxFor = async (to) => {
  const d = await json(await req.get(`${BASE}/api/dev/wa-mock/outbox`));
  return (d?.outbox ?? []).filter((o) => o.body?.to === to).map((o) => o.body?.text?.body ?? `[${o.body?.type}]`);
};
const inbound = (text, from = PHONE) =>
  req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    data: { phoneNumberId: PN, from, name: NAME, text, waMessageId: `wamid.${randomBytes(8).toString("hex")}` },
  });
const fakeToken = randomBytes(16).toString("base64url");
const fakeSerial = "A".repeat(22);

if (!enabled) {
  console.log("\n== AC1: con la bandera apagada no existe nada ==");
  for (const path of [
    "/api/stamp-card/program",
    `/api/stamp-card/cards?contactId=ct_x`,
    "/api/stamp-card/poster",
    "/api/wallet/apple/v1/log",
    "/api/wallet/apple/v1/devices/dev1/registrations/pass.center.into.stamps",
    "/api/wallet/images/logo",
    "/api/analytics/stamp-card",
  ]) {
    const r = await req.get(`${BASE}${path}`);
    ok(`${path} → 404`, r.status() === 404, `fue ${r.status()}`);
  }
  const put = await req.put(`${BASE}/api/stamp-card/program`, { data: {} });
  ok("PUT del programa → 404", put.status() === 404);
  const anon = await browser.newContext();
  // Ajustes, como toda pantalla de (app), manda a «Entrar» sin sesión; con sesión da 404 (abajo).
  for (const path of [`/c/${fakeToken}`, `/c/${fakeToken}/apple`, `/c/${fakeToken}/google`, `/s/${fakeSerial}`, "/stamp-card/poster"]) {
    const r = await anon.request.get(`${BASE}${path}`, { maxRedirects: 0 });
    ok(`${path} sin sesión → 404 (no a «Entrar»)`, r.status() === 404, `fue ${r.status()}`);
  }
  await anon.close();
  const settings = await req.get(`${BASE}/settings/stamp-card`);
  ok("Ajustes → Tarjeta de sellos con sesión → 404", settings.status() === 404);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/branding`);
  ok("sin entrada en el menú de Ajustes", (await page.getByRole("link", { name: "Tarjeta de sellos" }).count()) === 0);
  await inbound("Quiero mi tarjeta de sellos");
  await sleep(1500);
  const cards = await sql`select count(*)::int as n from stamp_card`;
  ok("la frase de alta no crea tarjetas", cards[0].n === 0, `hay ${cards[0].n}`);
} else {
  console.log("\n== AC2: el programa ==");
  const program = {
    name: `Café ${S}`,
    stampsRequired: 3,
    reward: "1 bebida gratis",
    terms: "Un sello por compra",
    color: "#7a3b12",
    minHoursBetweenStamps: 4,
    joinPhrase: "Quiero mi tarjeta de sellos",
    joinReply: "Hola {nombre}, tu tarjeta de {negocio}: {enlace}",
    status: "active",
  };
  const bad = await req.put(`${BASE}/api/stamp-card/program`, { data: { ...program, stampsRequired: 31 } });
  ok("31 sellos → 422", bad.status() === 422);
  const noLink = await req.put(`${BASE}/api/stamp-card/program`, { data: { ...program, joinReply: "Hola" } });
  ok("respuesta sin {enlace} → 422", noLink.status() === 422);
  const put = await req.put(`${BASE}/api/stamp-card/program`, { data: program });
  ok("programa guardado", put.ok(), String(put.status()));
  await req.put(`${BASE}/api/agent/profile`, { data: { enabled: true } });

  console.log("\n== AC3: alta por WhatsApp, sin turno de IA ==");
  await inbound("¡Quiero mi TARJETA de sellos!");
  const replied = await until(async () => (await outboxFor(PHONE)).some((t) => t.includes("/c/")));
  const first = await outboxFor(PHONE);
  ok("responde con el enlace a la tarjeta", replied, JSON.stringify(first));
  ok("con el nombre y el negocio", first.some((t) => t.startsWith(`Hola ${NAME}, tu tarjeta de Café ${S}:`)), JSON.stringify(first));
  // El ai-mock contesta cualquier otro texto; aquí no debe decir nada.
  await sleep(Number(process.env.AGENT_COALESCE_MS ?? 6000) + 3000);
  ok("la IA no contesta ese mensaje", (await outboxFor(PHONE)).length === 1, JSON.stringify(await outboxFor(PHONE)));
  await inbound("quiero mi tarjeta de sellos");
  await until(async () => (await outboxFor(PHONE)).length >= 2);
  const both = (await outboxFor(PHONE)).filter((t) => t.includes("/c/"));
  ok("repetirla reenvía el MISMO enlace", both.length === 2 && both[0] === both[1], JSON.stringify(both));
  const [{ n: cardCount }] = await sql`
    select count(*)::int as n from stamp_card sc join contact c on c.id = sc.contact_id where c.wa_identity = ${PHONE}`;
  ok("y no crea otra tarjeta", cardCount === 1, `hay ${cardCount}`);
  // Control: el agente SÍ está encendido y contesta lo que no es la frase.
  await inbound("¿A qué hora abren?");
  const aiReplied = await until(async () => (await outboxFor(PHONE)).some((t) => t.includes("A qué hora abren")), 60000);
  ok("control: un mensaje normal sí lo contesta la IA", aiReplied, JSON.stringify(await outboxFor(PHONE)));
  ok("y la IA nunca vio la frase de alta", !(await outboxFor(PHONE)).some((t) => /tarjeta de sellos/i.test(t) && !t.includes("/c/")));
  const link = both[0].match(/https?:\/\/\S+\/c\/[A-Za-z0-9_-]{22}/)?.[0] ?? "";
  const [contact] = await sql`select id from contact where wa_identity = ${PHONE}`;

  console.log("\n== AC5: sumar sellos ==");
  const got = await json(await req.get(`${BASE}/api/stamp-card/cards?contactId=${contact.id}`));
  const card = got?.card;
  ok("la ficha ve la tarjeta", card?.stamps === 0 && card?.stampsRequired === 3, JSON.stringify(got));
  const stamp = (key, data = {}) =>
    req.post(`${BASE}/api/stamp-card/cards/${card.id}/stamp`, { data, headers: { "Idempotency-Key": key } });
  const noKey = await req.post(`${BASE}/api/stamp-card/cards/${card.id}/stamp`, { data: {} });
  ok("sin Idempotency-Key → 422", noKey.status() === 422);
  const k1 = `e2e-${S}-1`;
  const [a, b] = await Promise.all([stamp(k1), stamp(k1)]);
  const after = await json(await req.get(`${BASE}/api/stamp-card/cards/${card.id}`));
  ok("doble clic con la misma llave suma uno", a.ok() && b.ok() && after?.card?.stamps === 1, JSON.stringify(after?.card?.stamps));
  const soon = await stamp(`e2e-${S}-2`);
  const soonBody = await json(soon);
  ok("antes de 4 horas pide confirmación (409)", soon.status() === 409 && soonBody?.error?.code === "needs_confirmation" && !!soonBody?.nextAt);
  const forced = await stamp(`e2e-${S}-2`, { force: true });
  ok("confirmado, suma", forced.ok() && (await json(forced))?.card?.stamps === 2);
  const redeemEarly = await req.post(`${BASE}/api/stamp-card/cards/${card.id}/redeem`, { headers: { "Idempotency-Key": `e2e-${S}-r0` } });
  ok("canjear sin completar → 409", redeemEarly.status() === 409);
  const third = await json(await stamp(`e2e-${S}-3`, { force: true }));
  ok("el tercero completa la tarjeta", third?.completed === true && third?.card?.complete === true, JSON.stringify(third));

  console.log("\n== AC6: canjear ==");
  const redeem = await req.post(`${BASE}/api/stamp-card/cards/${card.id}/redeem`, { headers: { "Idempotency-Key": `e2e-${S}-r1` } });
  const redeemed = (await json(redeem))?.card;
  ok("canje: vuelve a 0 y cuenta 1", redeem.ok() && redeemed?.stamps === 0 && redeemed?.rewardsRedeemed === 1, JSON.stringify(redeemed));
  const events = await sql`select kind, user_id from stamp_event where card_id = ${card.id} order by created_at`;
  ok(
    "la bitácora tiene alta, tres sellos y el canje, con quién",
    events.map((e) => e.kind).join(",") === "join,stamp,stamp,stamp,redeem" && events.slice(1).every((e) => e.user_id),
    JSON.stringify(events)
  );
  const adjust = await req.post(`${BASE}/api/stamp-card/cards/${card.id}/adjust`, {
    data: { delta: 2 },
    headers: { "Idempotency-Key": `e2e-${S}-a1` },
  });
  ok("el dueño ajusta sellos", adjust.ok() && (await json(adjust))?.card?.stamps === 2);

  console.log("\n== AC4: la página pública ==");
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
  const pub = await phone.newPage();
  const res = await pub.goto(link);
  ok("abre con 200", res?.status() === 200, `${res?.status()} ${link}`);
  const text = await pub.locator("body").innerText();
  ok("muestra negocio, sellos y premio", text.includes(`Café ${S}`) && text.includes("2/3 sellos") && text.includes("1 bebida gratis"), text.slice(0, 200));
  ok("no muestra el nombre ni el teléfono del cliente", !text.includes(NAME) && !text.includes(PHONE.slice(-6)));
  const robots = await pub.locator('meta[name="robots"]').getAttribute("content");
  ok("noindex", (robots ?? "").includes("noindex"), robots ?? "");
  const scroll = await pub.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("sin scroll horizontal a 360 px", scroll <= 0, `${scroll}px`);
  ok("trae el QR", (await pub.locator("svg path").count()) > 0);
  if (process.env.E2E_SCREENSHOTS) await pub.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/stamp-card-public-360.png`, fullPage: true });
  const missing = await pub.goto(`${BASE}/c/${fakeToken}`);
  ok("un token inválido → 404", missing?.status() === 404);

  console.log("\n== AC7: el QR del equipo ==");
  const [{ serial }] = await sql`select serial from stamp_card where id = ${card.id}`;
  const anonPage = await phone.newPage();
  await anonPage.goto(`${BASE}/s/${serial}`);
  ok("sin sesión va a «Entrar» y vuelve después", anonPage.url().includes(`/login?next=${encodeURIComponent(`/s/${serial}`)}`), anonPage.url());
  ok("sin mostrar la tarjeta", !(await anonPage.locator("body").innerText()).includes(`Café ${S}`));
  await anonPage.getByLabel("Correo").fill(email);
  await anonPage.locator('input[type="password"]').fill(password);
  await anonPage.getByRole("button", { name: /Entrar|Iniciar/ }).click();
  await anonPage.waitForURL(`**/s/${serial}`, { timeout: 15000 }).catch(() => {});
  ok("tras entrar, vuelve a la tarjeta", anonPage.url().endsWith(`/s/${serial}`), anonPage.url());
  await anonPage.getByRole("button", { name: "Sumar sello" }).click();
  await anonPage.getByRole("button", { name: "Sumar igual" }).click();
  const viaQr = await until(async () => (await sql`select stamps from stamp_card where id = ${card.id}`)[0].stamps === 3, 10000);
  ok("«Sumar sello» con confirmación desde el QR", viaQr);
  const [{ source }] = await sql`select source from stamp_event where card_id = ${card.id} order by created_at desc limit 1`;
  ok("queda registrado como sellado con el QR", source === "qr", source);
  const redeemShown = await anonPage
    .getByRole("button", { name: "Canjear premio" })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  ok("con la tarjeta completa aparece «Canjear premio»", redeemShown);
  const horizontal = await anonPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("la pantalla del equipo cabe a 360 px", horizontal <= 0, `${horizontal}px`);
  if (process.env.E2E_SCREENSHOTS) await anonPage.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/stamp-card-staff-360.png`, fullPage: true });
  await phone.close();

  console.log("\n== AC13 y AC14: Ajustes, cartel y ficha ==");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/stamp-card`);
  ok("Ajustes → Tarjeta de sellos abre", await page.getByText("Cartel del mostrador").isVisible());
  ok("con la entrada en el menú", (await page.getByRole("link", { name: "Tarjeta de sellos" }).count()) > 0);
  const nfc = await page.getByLabel("Enlace para el QR y el sticker NFC").inputValue().catch(() => "");
  ok("muestra el enlace wa.me con la frase", /^https:\/\/wa\.me\/\d+\?text=Quiero%20mi%20tarjeta%20de%20sellos$/.test(nfc), nfc);
  const png = await req.get(`${BASE}/api/stamp-card/poster`);
  const pngBody = await png.body();
  ok("descarga el cartel en PNG", png.ok() && png.headers()["content-type"] === "image/png" && pngBody.subarray(1, 4).toString() === "PNG", `${png.status()} ${png.headers()["content-type"]}`);
  if (process.env.E2E_SCREENSHOTS) {
    const fs = await import("node:fs");
    fs.writeFileSync(`${process.env.E2E_SCREENSHOTS}/stamp-card-poster.png`, pngBody);
  }
  const poster = await req.get(`${BASE}/stamp-card/poster`);
  ok("la versión para imprimir abre", poster.ok() && (await poster.text()).includes("Escanea y envía por WhatsApp"));
  // El panel del contacto se ve al lado del hilo en escritorio ancho.
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${BASE}/inbox?contact=${contact.id}`);
  const panel = page.getByRole("region", { name: "Tarjeta de sellos" });
  ok("la Bandeja muestra la tarjeta en la ficha", await panel.getByText("3/3").waitFor({ timeout: 60000 }).then(() => true, () => false));
  if (process.env.E2E_SCREENSHOTS) await panel.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/stamp-card-inbox-panel.png` });
  await panel.getByRole("button", { name: "Canjear premio" }).click();
  const viaPanel = await until(async () => (await sql`select rewards_redeemed from stamp_card where id = ${card.id}`)[0].rewards_redeemed === 2, 10000);
  ok("y canjea desde ahí", viaPanel);
  await page.close();

  await walletChecks({ card, link, program });

  console.log("\n== AC12: Resultados ==");
  const today = new Date().toISOString().slice(0, 10);
  const results = await json(await req.get(`${BASE}/api/analytics/stamp-card?from=${today}&to=${today}`));
  ok(
    "la sección cuenta tarjetas, sellos, canjes y a los que volvieron",
    results && results.newCards.current >= 1 && results.stamps.current >= 3 && results.redeems.current >= 2 && results.returning.current >= 1,
    JSON.stringify(results)
  );

  console.log("\n== Pausa ==");
  await req.put(`${BASE}/api/stamp-card/program`, { data: { ...program, status: "paused" } });
  const paused = await stamp(`e2e-${S}-p1`, { force: true });
  ok("en pausa no se sella (409)", paused.status() === 409 && (await json(paused))?.error?.code === "program_paused");
  await req.put(`${BASE}/api/stamp-card/program`, { data: program });
}

/** Lee un zip «store» (el .pkpass): nombre → bytes. */
function readZip(buf) {
  const out = new Map();
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLength = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    const start = i + 30 + nameLength + extra;
    out.set(name, buf.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

/**
 * Cortes 2 y 3 — Los wallets contra el mock del central
 * (`INTO_CENTRAL_URL=${BASE}/api/dev/central-mock`). El final de la llave
 * elige el caso del mock: `…1234` plan con wallet, `…4031` sin wallet.
 */
async function walletChecks({ card, link }) {
  const central = (process.env.INTO_CENTRAL_URL ?? "").trim();
  console.log(`\n== AC8, AC10 y AC11: wallets (${central ? "con el mock del central" : "sin central"}) ==`);
  const pub = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await pub.newPage();
  if (!central) {
    await page.goto(link);
    ok("sin central no hay botones de wallet (D9)", (await page.getByText("Agregar a Apple Wallet").count()) === 0);
    const apple = await pub.request.get(`${link}/apple`);
    ok("…y pedir el pase lo explica (503)", apple.status() === 503, String(apple.status()));
    await pub.close();
    return;
  }
  const key = (end) => `into_live_${"E2e".repeat(9)}A${end}`;
  await req.delete(`${BASE}/api/dev/central-mock/v1/wallet/log`);
  const saved = await req.put(`${BASE}/api/settings/central`, { data: { key: key("1234") } });
  ok("llave de licencia con plan Pyme", saved.ok(), String(saved.status()));

  await page.goto(link);
  ok("la tarjeta ofrece «Agregar a Apple Wallet» (AC8)", await page.getByText("Agregar a Apple Wallet").isVisible());
  // http:// en el e2e: Google no puede bajar el logo, así que no se ofrece.
  ok("sin HTTPS no ofrece Google Wallet", (await page.getByText("Guardar en Google Wallet").count()) === 0);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/stamp-card-public-wallet-360.png`, fullPage: true });

  const res = await pub.request.get(`${link}/apple`);
  const zip = readZip(await res.body());
  ok("descarga el .pkpass", res.ok() && res.headers()["content-type"] === "application/vnd.apple.pkpass", `${res.status()} ${res.headers()["content-type"]}`);
  ok(
    "con pass.json, manifiesto, firma e imágenes",
    ["pass.json", "manifest.json", "signature", "icon.png", "logo@2x.png", "strip@3x.png"].every((n) => zip.has(n)),
    [...zip.keys()].join(",")
  );
  const pass = JSON.parse(zip.get("pass.json")?.toString() ?? "{}");
  const [{ serial }] = await sql`select serial from stamp_card where id = ${card.id}`;
  ok("el serial lleva el prefijo del cliente", pass.serialNumber === `cmocktest-${serial}`, pass.serialNumber);
  ok("el QR del pase es la pantalla del equipo", pass.barcodes?.[0]?.message === `${BASE}/s/${serial}`);
  ok("sin HTTPS, sin servicio web", pass.webServiceURL === undefined);
  const manifest = JSON.parse(zip.get("manifest.json")?.toString() ?? "{}");
  const { createHash } = await import("node:crypto");
  ok(
    "cada archivo coincide con su SHA-1 del manifiesto",
    Object.entries(manifest).every(([n, h]) => zip.has(n) && createHash("sha1").update(zip.get(n)).digest("hex") === h)
  );

  const log = await json(await req.get(`${BASE}/api/dev/central-mock/v1/wallet/log`));
  const sent = JSON.stringify(log?.bodies ?? []);
  ok("el central recibió la firma del manifiesto", (log?.bodies ?? []).some((b) => b.path === "apple/sign"), sent.slice(0, 200));
  ok("al central no le llegó el nombre ni el teléfono (AC11)", !sent.includes(NAME) && !sent.includes(PHONE), sent.slice(0, 200));
  const signedManifests = (log?.bodies ?? [])
    .filter((b) => b.path === "apple/sign")
    .map((b) => Buffer.from(b.body.manifest, "base64").toString());
  ok("…ni dentro del manifiesto firmado", signedManifests.every((m) => !m.includes(NAME) && !m.includes(PHONE)));

  // AC9 con el token del pase: el iPhone registra el pase y pide la última versión.
  const auth = `ApplePass ${pass.authenticationToken ?? "sin-token-en-http-xxxxxx"}`;
  if (pass.authenticationToken) {
    const reg = await req.post(`${BASE}/api/wallet/apple/v1/devices/e2edev/registrations/${pass.passTypeIdentifier}/${pass.serialNumber}`, {
      headers: { authorization: auth },
      data: { pushToken: "a1b2c3d4e5f6a7b8c9d0" },
    });
    ok("registra el dispositivo (AC9)", reg.status() === 201, String(reg.status()));
  }
  const unauth = await req.post(`${BASE}/api/wallet/apple/v1/devices/e2edev/registrations/pass.center.into.stamps/cmocktest-${serial}`, {
    headers: { authorization: "ApplePass AAAAAAAAAAAAAAAAAAAAAA" },
    data: { pushToken: "a1b2c3d4e5f6a7b8c9d0" },
  });
  ok("un token ajeno no registra nada (AC9)", unauth.status() === 401, String(unauth.status()));

  // AC10: con un plan sin wallet, la tarjeta sigue y los botones no salen.
  await req.put(`${BASE}/api/settings/central`, { data: { key: key("4031") } });
  await page.goto(link);
  ok("plan sin wallet: sin botones (AC10)", (await page.getByText("Agregar a Apple Wallet").count()) === 0);
  ok("…y la tarjeta se ve igual", (await page.locator("body").innerText()).includes("sellos"));
  await req.put(`${BASE}/api/settings/central`, { data: { key: key("1234") } });
  await pub.close();
}

await browser.close();
await sql.end();
console.log(`\n${checks - failures}/${checks} checks OK`);
process.exit(failures ? 1 : 0);
