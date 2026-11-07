/**
 * Self-test E2E — agenda con profesionales (spec 1029, guion
 * tests/e2e/us-agenda-resources.md).
 *
 * Con `AGENDA` apagada comprueba que nada existe (AC27). Encendida conduce la
 * historia: Ajustes, Citas a 1280 y 360 px, el agente en los dos modos y la
 * superficie del bot. Deja la agenda como la encontró: archiva a quien crea.
 *
 * Uso: node --env-file=.env scripts/e2e-agenda-resources.mjs
 * Requiere: app corriendo (`next dev`) con WA_MOCK_ENABLED=true, el ai-mock como
 * proveedor y BOT_API_KEY.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const AGENDA = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const PN = `PN-1029-${RUN}`;
const ANA = `Dra. Ana ${RUN}`;
const LUIS = `Dr. Luis ${RUN}`;

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

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const req = ctx.request;

async function api(path, opts = {}) {
  const res = await req.fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { origin: BASE, "content-type": "application/json", ...(opts.headers ?? {}) },
    data: opts.body,
    failOnStatusCode: false,
    timeout: 60000,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status(), json };
}
const bot = (path, opts = {}) =>
  api(path, { ...opts, headers: { "x-api-key": process.env.BOT_API_KEY } });

const created = [];
const bookings = [];
let savedSettings = null;

/** Un mensaje del cliente, y lo que le contestó el agente. */
async function say(from, text) {
  const before = (await outbox(from)).length;
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from, name: `Paciente ${RUN}`, text, waMessageId: `wam-${RUN}-${Math.random()}` },
  });
  let replies = [];
  await until(async () => {
    replies = (await outbox(from)).slice(before);
    return replies.length > 0;
  }, 45000);
  return replies.join("\n");
}
async function outbox(to) {
  const d = (await api("/api/dev/wa-mock/outbox")).json;
  return (d?.outbox ?? []).filter((o) => o.body?.to === to).map((o) => o.body?.text?.body ?? "");
}
const shot = async (page, name) => {
  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: false });
  }
};
const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function main() {
  console.log("== Setup ==");
  const email = "e2e@intosales.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password, name: "Operador E2E" },
  });
  if (su.status >= 300) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
  }
  ok("operator signs up or signs in", su.status < 300, String(su.status));

  if (!AGENDA) {
    console.log("\n== AC27: with the flag off nothing exists ==");
    for (const [path, method] of [
      ["/api/calendar/resources", "GET"],
      ["/api/calendar/resources", "POST"],
      ["/api/calendar/resources/res_x", "PATCH"],
    ]) {
      const r = await api(path, { method, body: method === "GET" ? undefined : {} });
      ok(`${method} ${path} → 404`, r.status === 404, String(r.status));
    }
    return;
  }

  await api("/api/settings/whatsapp", {
    method: "PUT",
    body: { wabaId: `WABA-${RUN}`, phoneNumberId: PN, token: "tok-1029" },
  });
  savedSettings = (await api("/api/calendar/settings")).json?.settings;
  const everyDay = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "08:00", end: "20:00" }]])
  );
  await api("/api/calendar/settings", {
    method: "PUT",
    body: { weeklyHours: everyDay, minNoticeHours: 0, maxDaysAhead: 14, slotMinutes: 30 },
  });
  // Lo que quedó de otros guiones no debe contar aquí.
  const leftovers = (await api("/api/calendar/resources")).json?.resources ?? [];
  ok("starts without active resources", leftovers.length === 0, JSON.stringify(leftovers.map((r) => r.name)));

  console.log("\n== H1: settings ==");
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings/calendar`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const card = page.getByTestId("agenda-resources");
  ok("settings show the resources card", await until(() => card.isVisible(), 30000));
  await page.locator("#resource-name").fill(ANA);
  await card.getByRole("button", { name: "Agregar" }).click();
  ok("adds the first person", await until(async () => (await page.getByTestId("resource-row").count()) === 1));
  ok("one person: no agent mode", (await page.getByTestId("agent-resource-mode").count()) === 0);
  await page.locator("#resource-name").fill(LUIS);
  await card.getByRole("button", { name: "Agregar" }).click();
  ok("adds the second person", await until(async () => (await page.getByTestId("resource-row").count()) === 2));
  ok("two people: agent mode appears (AC18)", await until(() => page.getByTestId("agent-resource-mode").isVisible()));

  const list = (await api("/api/calendar/resources")).json;
  const ana = list?.resources?.find((r) => r.name === ANA);
  const luis = list?.resources?.find((r) => r.name === LUIS);
  created.push(ana?.id, luis?.id);
  ok("default mode is first free", list?.agentResourceMode === "first_free");
  ok("a new resource copies the business hours (AC2)", ana?.weeklyHours?.sat?.[0]?.start === "08:00");

  const luisRow = page.getByTestId("resource-row").filter({ hasText: LUIS });
  await luisRow.getByRole("button", { name: "Editar" }).click();
  await luisRow.getByRole("button", { name: "Domingo" }).click();
  await luisRow.getByRole("button", { name: "Guardar horario" }).click();
  const hoursSaved = await until(async () => {
    const r = (await api("/api/calendar/resources")).json?.resources?.find((x) => x.id === luis.id);
    return r && !r.weeklyHours.sun;
  });
  ok("edits a person's hours (AC1)", hoursSaved);
  ok("settings do not overflow on desktop", await noOverflow(page));
  await card.scrollIntoViewIfNeeded();
  await shot(page, "1029-settings-desktop");

  console.log("\n== H3: bookings ==");
  const LEAD = `5216${Math.floor(10000000 + Math.random() * 89999999)}`;
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from: LEAD, name: `Paciente ${RUN}`, text: "hola", waMessageId: `wam-${RUN}-0` },
  });
  await sleep(1000);
  await page.goto(`${BASE}/bookings?vista=semana`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const filter = page.getByLabel("Ver la agenda de");
  ok("two people: the calendar can be filtered (AC14)", await until(() => filter.isVisible(), 30000));
  await page.getByRole("button", { name: "Nueva cita" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva cita" });
  await dialog.getByLabel("Contacto").fill(`Paciente ${RUN}`);
  await dialog.getByRole("button", { name: new RegExp(`Paciente ${RUN}`) }).first().click();
  const who = dialog.getByLabel("Con quién atiende");
  ok("new booking asks who attends (AC12)", await who.isVisible());
  ok("offers first free", (await who.locator("option").first().textContent()) === "Primero libre");
  await who.selectOption({ label: ANA });
  const anaSlot = dialog.locator("[data-start]").first();
  await until(() => anaSlot.isVisible());
  await shot(page, "1029-new-booking-desktop");
  const start = await anaSlot.getAttribute("data-start");
  await anaSlot.click();
  await dialog.getByRole("button", { name: "Crear cita" }).click();
  ok("creates the booking", await until(async () => (await dialog.count()) === 0));

  const day = new Date(start).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const inDay = async () => (await api(`/api/bookings?from=${day}&to=${day}`)).json?.bookings ?? [];
  const first = (await inDay()).find((b) => b.scheduledAtUtc === start);
  if (first) bookings.push(first.id);
  ok("the booking stores who (AC12)", first?.resource?.id === ana.id, JSON.stringify(first?.resource));

  const second = await api("/api/bookings", {
    method: "POST",
    body: { kind: "session", contactId: first.contact.id, startUtc: start, resourceId: luis.id },
  });
  if (second.json?.booking) bookings.push(second.json.booking.id);
  ok("another person can have the same instant (AC6)", second.status === 201, String(second.status));
  const third = await api("/api/bookings", {
    method: "POST",
    body: { kind: "session", contactId: first.contact.id, startUtc: start, resourceId: ana.id },
  });
  ok("the same person cannot (AC7)", third.status === 409 && third.json?.error?.code === "slot_taken", String(third.status));

  await page.goto(`${BASE}/bookings?vista=dia&fecha=${day}&resource=${ana.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const events = page.locator(`[aria-label*="${ANA}"]`);
  ok("the filter lives in the URL and shows that person (AC14)", await until(async () => (await events.count()) >= 1, 30000));
  ok("…and hides the other", (await page.locator(`[aria-label*="${LUIS}"]`).count()) === 0);
  await events.first().click();
  const drawer = page.getByRole("dialog", { name: /^Cita:/ });
  ok("the drawer says who (AC14)", await until(async () => (await drawer.textContent())?.includes(`Con ${ANA}`)));
  await shot(page, "1029-drawer-desktop");
  await drawer.getByRole("button", { name: "Reprogramar" }).click();
  const moveWho = drawer.getByLabel("Con quién atiende");
  ok("moving can change the person (AC15)", await until(() => moveWho.isVisible()));
  ok("…starting from the current one", (await moveWho.inputValue()) === ana.id);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Bloquear horario" }).first().click();
  const block = page.getByRole("dialog", { name: "Bloquear horario" });
  ok("blocking asks for whom (AC16)", await until(() => block.getByLabel("A quién bloquea").isVisible()));
  await block.getByRole("button", { name: "Cancelar" }).click();

  console.log("\n== AC17: at 360 px ==");
  const phone = await browser.newContext({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.addCookies(await ctx.cookies());
  const mp = await phone.newPage();
  await mp.goto(`${BASE}/bookings?vista=dia&fecha=${day}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  ok("bookings show the filter", await until(() => mp.getByLabel("Ver la agenda de").isVisible(), 30000));
  ok("bookings do not overflow", await until(() => noOverflow(mp)));
  await shot(mp, "1029-calendar-360");
  const filterBox = await mp.getByLabel("Ver la agenda de").boundingBox();
  ok("the filter is tappable (≥ 40 px)", (filterBox?.height ?? 0) >= 40, String(filterBox?.height));
  await mp.getByRole("button", { name: "Nueva cita" }).click();
  const mobileDialog = mp.getByRole("dialog", { name: "Nueva cita" });
  ok("the dialog fits", await until(() => mobileDialog.isVisible()));
  ok("…without overflow", await noOverflow(mp));
  await shot(mp, "1029-new-booking-360");
  await mp.keyboard.press("Escape");
  await mp.goto(`${BASE}/settings/calendar`, { waitUntil: "domcontentloaded", timeout: 60000 });
  ok("settings show resources", await until(() => mp.getByTestId("agenda-resources").isVisible(), 30000));
  ok("settings do not overflow", await until(() => noOverflow(mp)));
  await mp.getByTestId("agenda-resources").scrollIntoViewIfNeeded();
  await shot(mp, "1029-settings-360");
  await phone.close();

  await api("/api/agent/profile", { method: "PUT", body: { enabled: true } });

  console.log("\n== H4: first free mode ==");
  const LEAD2 = `5217${Math.floor(10000000 + Math.random() * 89999999)}`;
  await api(`/api/calendar/settings`, { method: "PUT", body: { agentResourceMode: "first_free" } });
  const offered = await say(LEAD2, "quiero una cita");
  ok("offers slots without asking (AC21)", offered.includes("•") && !offered.includes("¿Con quién"), offered);
  const booked = await say(LEAD2, "el primero, confirmo");
  ok("confirms with the name (AC23)", booked.includes("Te atiende"), booked);

  console.log("\n== H4: ask mode ==");
  await api(`/api/calendar/settings`, { method: "PUT", body: { agentResourceMode: "ask" } });
  const LEAD3 = `5218${Math.floor(10000000 + Math.random() * 89999999)}`;
  const question = await say(LEAD3, "quiero una cita");
  ok("the engine asks with real names (AC19)", question.includes(ANA) && question.includes(LUIS), question);
  const withAna = await say(LEAD3, `con ${ANA}`);
  ok("offers that person's slots (AC20)", withAna.includes("•"), withAna);
  const confirmed = await say(LEAD3, "el primero, confirmo");
  ok("the booking stays with her", confirmed.includes(`Te atiende ${ANA}`), confirmed);

  console.log("\n== AC24: the bot ==");
  const LEAD4 = `5219${Math.floor(10000000 + Math.random() * 89999999)}`;
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from: LEAD4, name: `Bot ${RUN}`, text: "hola", waMessageId: `wam-${RUN}-b` },
  });
  let conv = null;
  await until(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = convs.find((c) => c.contact?.name === `Bot ${RUN}`) ?? null;
    return conv;
  });
  const avail = await bot(`/api/bot/availability?conversationId=${conv?.id}&resourceId=${luis.id}`);
  ok("the bot asks for one person's slots", avail.status === 200 && avail.json?.slots?.length > 0, String(avail.status));
  ok("…and reads the mode and the list", avail.json?.resourceMode === "ask" && avail.json?.resources?.length === 2);
  const slot = avail.json?.slots?.[0]?.startUtc;
  const wrong = await bot("/api/bot/bookings", {
    method: "POST",
    body: { conversationId: conv?.id, startUtc: slot, resourceId: ana.id },
  });
  ok("another person is slot_not_offered (AC22)", wrong.status === 409 && wrong.json?.error?.code === "slot_not_offered", String(wrong.status));
  const right = await bot("/api/bot/bookings", {
    method: "POST",
    body: { conversationId: conv?.id, startUtc: slot },
  });
  ok("the booking stays with who was offered", right.status === 201 && right.json?.resource?.id === luis.id, JSON.stringify(right.json));
  if (right.json?.bookingId) bookings.push(right.json.bookingId);
  await page.close();
}

try {
  await main();
} catch (err) {
  failures++;
  console.log(`  ✗ exception: ${err?.stack ?? err}`);
} finally {
  // Deja la agenda como estaba: con profesionales activos, los demás guiones
  // no verían la agenda del negocio.
  const all = (await api("/api/bookings").catch(() => null))?.json?.bookings ?? [];
  const mine = new Set(created);
  const open = all.filter((b) => mine.has(b.resource?.id) && b.status === "agendada");
  for (const b of open) await api(`/api/bookings/${b.id}`, { method: "PATCH", body: { action: "cancel" } });
  for (const id of created.filter(Boolean)) {
    const r = await api(`/api/calendar/resources/${id}`, { method: "PATCH", body: { active: false } });
    if (r.status !== 200) console.log(`  · could not archive ${id}: ${r.status}`);
  }
  if (savedSettings) {
    await api("/api/calendar/settings", { method: "PUT", body: { ...savedSettings, agentResourceMode: "first_free" } });
  }
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} checks OK`);
process.exit(failures ? 1 : 0);
