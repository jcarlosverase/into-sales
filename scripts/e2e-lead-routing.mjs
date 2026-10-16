#!/usr/bin/env node
/**
 * 022 — End-to-end check of lead routing against a live app.
 *
 * Usage (against an EMPTY database; signup closes after the first org):
 *   BASE_URL=http://localhost:3000 node scripts/e2e-lead-routing.mjs
 *
 * Covers specs/026-reparto-de-leads AC1-AC3, AC5-AC7, AC9, AC11-AC13 over
 * HTTP, through the manual-capture path (the webhook uses the same
 * `createLeadForContact`). Exits non-zero on the first failure.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "password-e2e-022";
let failures = 0;

function ok(name, cond, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : `  ${detail}`}`);
  if (!cond) failures++;
}

/** A logged-in HTTP client with its own cookie jar. */
function client() {
  let cookie = "";
  const api = async function api(path, opts = {}) {
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
  };
  api.cookie = () => cookie;
  return api;
}

/**
 * Listens to /api/events as that user and keeps everything received, so a
 * check can ask later whether a conversation ever reached them (AC8).
 */
function listen(api) {
  const controller = new AbortController();
  const state = { text: "", ready: null };
  state.ready = fetch(`${BASE}/api/events`, { headers: { cookie: api.cookie() }, signal: controller.signal }).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          state.text += decoder.decode(value, { stream: true });
        }
      } catch {}
    })();
  });
  state.stop = () => controller.abort();
  return state;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const put = (body) => ({ method: "PUT", body: JSON.stringify(body) });
const patch = (body) => ({ method: "PATCH", body: JSON.stringify(body) });

let phoneSeq = 0;
async function capture(api, name) {
  phoneSeq++;
  const r = await api("/api/contacts", post({ name, phone: `51900000${String(phoneSeq).padStart(3, "0")}` }));
  return r.json?.contact?.id;
}

async function boardOf(api) {
  const r = await api("/api/pipeline/board");
  return r.json;
}

async function signIn(email) {
  const api = client();
  const r = await api("/api/auth/sign-in/email", post({ email, password: PASSWORD }));
  ok(`sign in as ${email}`, r.res.ok, JSON.stringify(r.json));
  return api;
}

async function main() {
  console.log("== Setup: owner and two sales reps ==");
  const owner = client();
  const su = await owner(
    "/api/auth/sign-up/email",
    post({ email: "owner@intosales.test", password: PASSWORD, name: "Owner E2E" })
  );
  ok("owner signs up (empty database)", su.res.ok, JSON.stringify(su.json));
  if (!su.res.ok) process.exit(1);

  for (const [name, email] of [
    ["Ana Rep", "ana@intosales.test"],
    ["Beto Rep", "beto@intosales.test"],
  ]) {
    const r = await owner("/api/settings/team", post({ name, email, password: PASSWORD }));
    ok(`team account for ${name}`, r.res.status === 201, JSON.stringify(r.json));
  }

  const routing = await owner("/api/settings/lead-routing");
  ok("routing is on by default", routing.json?.enabled === true);
  ok("routing lists both reps in order",
    routing.json?.members?.map((m) => m.name).join(",") === "Ana Rep,Beto Rep",
    JSON.stringify(routing.json));
  const [ana, beto] = routing.json.members.map((m) => m.userId);

  console.log("\n== AC1: round robin ==");
  const c1 = await capture(owner, "Lead Uno");
  const c2 = await capture(owner, "Lead Dos");
  const c3 = await capture(owner, "Lead Tres");
  let board = await boardOf(owner);
  const byContact = (b, id) => b.leads.find((l) => l.contact.id === id);
  ok("lead 1 → Ana", byContact(board, c1)?.assignee?.id === ana);
  ok("lead 2 → Beto", byContact(board, c2)?.assignee?.id === beto);
  ok("lead 3 → Ana", byContact(board, c3)?.assignee?.id === ana);
  ok("owner can assign and gets the team", board.canAssign === true && board.team.length === 3);

  console.log("\n== AC6, AC7: a rep only sees their own ==");
  const anaApi = await signIn("ana@intosales.test");
  board = await boardOf(anaApi);
  ok("Ana's board has her 2 leads", board.leads.length === 2, JSON.stringify(board.leads.map((l) => l.contact.name)));
  ok("Ana cannot assign", board.canAssign === false && board.team.length === 0);
  const anaContacts = await anaApi("/api/contacts");
  ok("Ana's contacts are her 2", anaContacts.json?.contacts?.length === 2, `${anaContacts.res.status}`);
  const anaInbox = await anaApi("/api/conversations");
  ok("Ana's inbox loads (no conversations yet)", anaInbox.res.ok && anaInbox.json?.conversations?.length === 0, `${anaInbox.res.status}`);
  const foreign = await anaApi(`/api/contacts/${c2}`);
  ok("Beto's contact is 404 for Ana", foreign.res.status === 404);
  const foreignPatch = await anaApi(`/api/contacts/${c2}`, patch({ notes: "x" }));
  ok("Ana cannot edit Beto's contact (404)", foreignPatch.res.status === 404);
  const ownerBoard = await boardOf(owner);
  const betoLead = byContact(ownerBoard, c2);
  const foreignLead = await anaApi(`/api/pipeline/leads/${betoLead.id}`, patch({ priority: "alta" }));
  ok("Ana cannot touch Beto's lead (404)", foreignLead.res.status === 404);

  console.log("\n== AC12: only supervisors reassign ==");
  const anaLead = byContact(ownerBoard, c1);
  const selfAssign = await anaApi(`/api/pipeline/leads/${anaLead.id}`, patch({ assignedUserId: beto }));
  ok("Ana reassigning gets 403", selfAssign.res.status === 403);
  const anaPut = await anaApi("/api/settings/lead-routing", put({ enabled: false }));
  ok("Ana changing routing gets 403 (AC13)", anaPut.res.status === 403);

  console.log("\n== AC10, AC11: owner reassigns ==");
  const moved = await owner(`/api/pipeline/leads/${anaLead.id}`, patch({ assignedUserId: beto }));
  ok("owner hands lead 1 to Beto", moved.res.ok, JSON.stringify(moved.json));
  board = await boardOf(anaApi);
  ok("Ana no longer sees lead 1", board.leads.length === 1);
  const bad = await owner(`/api/pipeline/leads/${anaLead.id}`, patch({ assignedUserId: "usr_nobody" }));
  ok("assigning outside the team is 422", bad.res.status === 422);
  const unassign = await owner(`/api/pipeline/leads/${anaLead.id}`, patch({ assignedUserId: null }));
  ok("owner can leave it unassigned", unassign.res.ok && (await boardOf(owner)).leads.find((l) => l.id === anaLead.id)?.assignee === null);

  console.log("\n== AC2: a rep out of the rotation ==");
  const off = await owner("/api/settings/lead-routing", put({ userId: beto, receivesLeads: false }));
  ok("owner takes Beto out of the rotation", off.res.ok && off.json.members[1].receivesLeads === false);
  const c4 = await capture(owner, "Lead Cuatro");
  const c5 = await capture(owner, "Lead Cinco");
  board = await boardOf(owner);
  ok("next leads all go to Ana", byContact(board, c4)?.assignee?.id === ana && byContact(board, c5)?.assignee?.id === ana);
  ok("Beto keeps his lead", byContact(board, c2)?.assignee?.id === beto);

  console.log("\n== AC3, AC9: routing off ==");
  await owner("/api/settings/lead-routing", put({ enabled: false }));
  const c6 = await capture(owner, "Lead Seis");
  board = await boardOf(owner);
  ok("lead stays unassigned", byContact(board, c6)?.assignee === null);
  ok("owner sees the unassigned lead", !!byContact(board, c6));
  board = await boardOf(anaApi);
  ok("Ana does not see the unassigned lead", !byContact(board, c6));

  console.log("\n== AC5: a rep keeps what they capture ==");
  const c7 = await capture(anaApi, "Lead de Ana");
  board = await boardOf(anaApi);
  ok("Ana's own capture is hers", byContact(board, c7)?.assignee?.id === ana);

  console.log("\n== AC4, AC6–AC8: a WhatsApp lead, its inbox and live events ==");
  // Needs the app with WA_MOCK_ENABLED=true and META_GRAPH_BASE_URL → wa-mock.
  await owner("/api/settings/lead-routing", put({ enabled: true }));
  await owner("/api/settings/lead-routing", put({ userId: beto, receivesLeads: true }));
  const wa = await owner("/api/settings/whatsapp", put({ wabaId: "WABA-LR", phoneNumberId: "PN-LR-1", token: "tok-lr" }));
  ok("owner connects WhatsApp (wa-mock)", wa.res.ok, JSON.stringify(wa.json));
  const betoApi = await signIn("beto@intosales.test");
  const anaEvents = listen(anaApi);
  const betoEvents = listen(betoApi);
  await Promise.all([anaEvents.ready, betoEvents.ready]);

  const phone = `5219990${String(Date.now()).slice(-6)}`;
  const inbound = await owner(
    "/api/dev/wa-mock/inbound",
    post({ phoneNumberId: "PN-LR-1", from: phone, name: "Prospecto WhatsApp", text: "hola, quiero información", waMessageId: `wamid.lr.${Date.now()}` })
  );
  ok("a WhatsApp message arrives", inbound.res.ok, JSON.stringify(inbound.json));
  let conv = null;
  for (let i = 0; i < 30 && !conv; i++) {
    await sleep(300);
    conv = (await owner("/api/conversations")).json?.conversations?.find((c) => c.contact?.name === "Prospecto WhatsApp") ?? null;
  }
  ok("the owner sees the new conversation", !!conv);
  board = await boardOf(owner);
  const waLead = board.leads.find((l) => l.contact.name === "Prospecto WhatsApp");
  ok("the webhook lead goes to a rep by turn (AC4)", [ana, beto].includes(waLead?.assignee?.id), JSON.stringify(waLead?.assignee));
  const [mine, other, mineEvents, otherEvents] =
    waLead?.assignee?.id === ana ? [anaApi, betoApi, anaEvents, betoEvents] : [betoApi, anaApi, betoEvents, anaEvents];

  ok("the assigned rep sees it in the inbox (AC6)", (await mine("/api/conversations")).json?.conversations?.some((c) => c.id === conv?.id));
  ok("the other rep does not (AC6)", !(await other("/api/conversations")).json?.conversations?.some((c) => c.id === conv?.id));
  ok(
    "the other rep cannot touch the conversation (AC7, 404)",
    (await other(`/api/conversations/${conv?.id}`, patch({ markRead: true }))).res.status === 404
  );
  ok("its messages are 404 for the other rep (AC7)", (await other(`/api/conversations/${conv?.id}/messages`)).res.status === 404);

  // A second message on the same conversation, now that both are listening.
  await owner(
    "/api/dev/wa-mock/inbound",
    post({ phoneNumberId: "PN-LR-1", from: phone, name: "Prospecto WhatsApp", text: "¿siguen ahí?", waMessageId: `wamid.lr.2.${Date.now()}` })
  );
  for (let i = 0; i < 30 && !mineEvents.text.includes(conv?.id); i++) await sleep(200);
  await sleep(1000);
  ok("the assigned rep gets it live (AC8)", mineEvents.text.includes(conv?.id));
  ok("the other rep never gets it live (AC8)", !otherEvents.text.includes(conv?.id));
  anaEvents.stop();
  betoEvents.stop();

  if (/^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim())) {
    console.log("\n== D11, AC15–AC16: bookings by sales rep (AGENDA=on) ==");
    const days = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "08:00", end: "20:00" }]])
    );
    const cal = await owner("/api/calendar/settings", put({ weeklyHours: days, slotMinutes: 30, minNoticeHours: 0, maxDaysAhead: 7, connector: "enlace-fijo", meetingLink: "https://meet.example/sala" }));
    ok("owner sets the calendar", cal.res.ok, JSON.stringify(cal.json));
    const slots = (await owner("/api/calendar/availability")).json?.slots ?? [];
    ok("there are free slots", slots.length >= 3, `slots=${slots.length}`);
    const anaContact = await capture(anaApi, "Cita de Ana");
    const betoContact = await capture(betoApi, "Cita de Beto");
    const book = (api, contactId, slot) => api("/api/bookings", post({ kind: "session", contactId, startUtc: slot.startUtc }));
    const anaBooking = await book(owner, anaContact, slots[0]);
    const betoBooking = await book(owner, betoContact, slots[1]);
    ok("owner books for both reps' contacts", anaBooking.res.status === 201 && betoBooking.res.status === 201, `${anaBooking.res.status} ${betoBooking.res.status}`);
    const anaId = anaBooking.json?.booking?.id;
    const betoId = betoBooking.json?.booking?.id;

    const listIds = async (api) => ((await api("/api/bookings")).json?.bookings ?? []).map((b) => b.id);
    const anaSees = await listIds(anaApi);
    ok("Ana sees her contact's booking (AC15)", anaSees.includes(anaId));
    ok("Ana does not see Beto's booking (AC15)", !anaSees.includes(betoId));
    const ownerSees = await listIds(owner);
    ok("the owner sees both (AC15)", ownerSees.includes(anaId) && ownerSees.includes(betoId));
    ok("Ana cannot cancel Beto's booking (AC16, 404)", (await anaApi(`/api/bookings/${betoId}`, patch({ action: "cancel" }))).res.status === 404);
    ok("Ana cannot book Beto's contact (AC16, 404)", (await book(anaApi, betoContact, slots[2])).res.status === 404);
    ok("Ana can cancel her own", (await anaApi(`/api/bookings/${anaId}`, patch({ action: "cancel" }))).res.ok);
  }

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
