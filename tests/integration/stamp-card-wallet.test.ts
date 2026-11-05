import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JOIN_PHRASE, DEFAULT_JOIN_REPLY } from "@/lib/stamp-card";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

// La sincronización en segundo plano se llama a mano aquí, para ver cada paso.
vi.mock("@/server/stamp-card/wallet-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stamp-card/wallet-sync")>()),
  kickWalletSync: () => undefined,
  kickProgramSync: () => undefined,
}));

/**
 * 1023, cortes 2 y 3 — Los wallets contra PostgreSQL y un central de mentira:
 * el `.pkpass`, el servicio web de Apple (AC9), la sincronización con
 * reintentos (D9, AC10), Google y que al central no le llegue nada del
 * cliente (AC11).
 */
describe.skipIf(!TEST_DATABASE_URL)("1023 — stamp card wallets", () => {
  let drop: () => Promise<void>;
  const org = "org_wallet";
  const key = `into_live_${"a".repeat(28)}1234`;
  const contact = { id: "ct_luz", name: "Luz Pérez", phone: "51900000011" };
  const scope = "cmocktest";

  type Call = { method: string; path: string; body: unknown };
  let calls: Call[] = [];
  let centralDown = false;
  let planWithoutWallet = false;
  const savedObjects = new Set<string>();

  /** El central, según el contrato de la spec 016. */
  const central: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (centralDown) throw new TypeError("fetch failed");
    expect(url.origin).toBe("https://central.test");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
    if (planWithoutWallet) {
      return Response.json({ error: { code: "plan_without_wallet", message: "no" } }, { status: 403 });
    }
    const path = url.pathname;
    if (path === "/v1/wallet/config") {
      return Response.json({
        scope,
        apple: { enabled: true, pass_type_id: "pass.center.into.stamps", team_id: "ABCDE12345" },
        google: { enabled: true, issuer_id: "3388000000012345678" },
      });
    }
    if (path === "/v1/wallet/apple/sign") return Response.json({ signature: Buffer.from("firma").toString("base64") });
    if (path === "/v1/wallet/apple/push") {
      const tokens = (body as { push_tokens: string[] }).push_tokens;
      const invalid = tokens.filter((t) => t.startsWith("dead"));
      return Response.json({ sent: tokens.length - invalid.length, invalid });
    }
    if (path.startsWith("/v1/wallet/google/classes/")) return Response.json({ id: "x", version: (body as { version: number }).version });
    if (path === "/v1/wallet/google/save-link") {
      savedObjects.add((body as { object_suffix: string }).object_suffix);
      return Response.json({ url: "https://pay.google.com/gp/v/save/jwt" });
    }
    if (path.startsWith("/v1/wallet/google/objects/")) {
      const suffix = decodeURIComponent(path.split("/").pop()!);
      return Response.json({ version: (body as { version: number }).version, saved: savedObjects.has(suffix) });
    }
    return new Response(null, { status: 404 });
  };

  let cardId = "";
  let serial = "";

  beforeAll(async () => {
    // HTTPS público: con él hay servicio web de Apple y Google Wallet.
    process.env.APP_BASE_URL = "https://crm.test";
    process.env.STAMP_CARD = "on";
    process.env.INTO_CENTRAL_URL = "https://central.test";
    ({ drop } = await useTestDatabase());
    vi.stubGlobal("fetch", central);
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    await db.insert(schema.organization).values({ id: org, name: "Café" });
    await db.insert(schema.contact).values({
      id: contact.id,
      organizationId: org,
      waIdentity: contact.phone,
      phone: contact.phone,
      name: contact.name,
    });
    const { saveKey } = await import("@/server/central/license");
    await saveKey(org, key);
    const { saveProgram } = await import("@/server/stamp-card/program");
    await saveProgram(org, {
      name: "Café La Esquina",
      stampsRequired: 3,
      reward: "1 bebida gratis",
      terms: "Una por visita",
      color: "#0070e0",
      minHoursBetweenStamps: 0,
      joinPhrase: DEFAULT_JOIN_PHRASE,
      joinReply: DEFAULT_JOIN_REPLY,
      status: "active",
    });
    const { ensureCard } = await import("@/server/stamp-card/cards");
    const { card } = await ensureCard(org, contact.id, { source: "panel" });
    cardId = card.id;
    serial = card.serial;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.STAMP_CARD;
    delete process.env.INTO_CENTRAL_URL;
    await drop?.();
  });

  beforeEach(async () => {
    centralDown = false;
    planWithoutWallet = false;
    const { clearWalletConfigCache } = await import("@/server/central/wallet");
    clearWalletConfigCache();
  });

  async function loadCard() {
    const { getDb, schema } = await import("@/lib/db");
    const [card] = await getDb().select().from(schema.stampCard).where(eq(schema.stampCard.id, cardId));
    return card!;
  }

  async function loadProgram() {
    const { getProgram } = await import("@/server/stamp-card/program");
    return (await getProgram(org))!;
  }

  it("la página ofrece Apple y Google con el central y un plan con wallet (AC8)", async () => {
    const { walletAvailability } = await import("@/server/stamp-card/wallet");
    expect(await walletAvailability(org)).toEqual({ apple: "available", google: "available" });
  });

  it("con un plan sin wallet no hay botones; con el central caído se explica (AC10)", async () => {
    const { walletAvailability } = await import("@/server/stamp-card/wallet");
    const { clearWalletConfigCache } = await import("@/server/central/wallet");
    planWithoutWallet = true;
    expect(await walletAvailability(org)).toEqual({ apple: "hidden", google: "hidden" });
    planWithoutWallet = false;
    clearWalletConfigCache();
    centralDown = true;
    expect(await walletAvailability(org)).toEqual({ apple: "unavailable", google: "unavailable" });
  });

  it("arma un .pkpass con el serial del cliente y el central solo ve el manifiesto (AC8, D8)", async () => {
    const { buildApplePass } = await import("@/server/stamp-card/apple-pass");
    const { readZipStore } = await import("@/server/stamp-card/pkpass");
    calls = [];
    const zip = readZipStore(await buildApplePass(await loadCard(), await loadProgram()));
    for (const name of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "logo@3x.png", "strip.png", "strip@2x.png"]) {
      expect(zip.has(name), name).toBe(true);
    }
    expect(zip.get("strip@2x.png")!.subarray(1, 4).toString()).toBe("PNG");
    const pass = JSON.parse(zip.get("pass.json")!.toString());
    expect(pass).toMatchObject({
      passTypeIdentifier: "pass.center.into.stamps",
      teamIdentifier: "ABCDE12345",
      serialNumber: `${scope}-${serial}`,
      webServiceURL: "https://crm.test/api/wallet/apple",
      logoText: "Café La Esquina",
    });
    expect(pass.authenticationToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pass.barcodes[0].message).toBe(`https://crm.test/s/${serial}`);
    // El manifiesto lista cada archivo con su SHA-1, y es lo que se firmó.
    const manifest = JSON.parse(zip.get("manifest.json")!.toString()) as Record<string, string>;
    for (const [name, hash] of Object.entries(manifest)) {
      expect(createHash("sha1").update(zip.get(name)!).digest("hex")).toBe(hash);
    }
    expect(zip.get("signature")!.toString()).toBe("firma");
    const sign = calls.find((c) => c.path === "/v1/wallet/apple/sign")!;
    expect(Object.keys(sign.body as object).sort()).toEqual(["manifest", "serial"]);
    expect(Buffer.from((sign.body as { manifest: string }).manifest, "base64").equals(zip.get("manifest.json")!)).toBe(true);
  });

  it("servicio web de Apple: registrar, cambios desde una marca, pase al día y baja (AC9)", async () => {
    const svc = await import("@/server/stamp-card/apple-service");
    const { appleAuthTokenFor } = await import("@/server/stamp-card/tokens");
    const serialNumber = `${scope}-${serial}`;
    const passType = "pass.center.into.stamps";
    const req = (auth: string | null, body?: unknown, headers: Record<string, string> = {}) =>
      new Request("https://crm.test/x", {
        method: body ? "POST" : "GET",
        headers: { ...(auth ? { authorization: auth } : {}), ...headers, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const auth = `ApplePass ${appleAuthTokenFor(cardId)}`;
    const push = { pushToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90" };

    expect((await svc.registerDevice(req(null, push), "dev1", passType, serialNumber)).status).toBe(401);
    expect((await svc.registerDevice(req("ApplePass AAAAAAAAAAAAAAAAAAAAAA", push), "dev1", passType, serialNumber)).status).toBe(401);
    expect((await svc.registerDevice(req(auth, push), "dev1", passType, serialNumber)).status).toBe(201);
    expect((await svc.registerDevice(req(auth, push), "dev1", passType, serialNumber)).status).toBe(200);
    expect((await svc.registerDevice(req(auth, { pushToken: "deadbeefdeadbeefdead" }), "dev2", passType, serialNumber)).status).toBe(201);

    const first = await svc.updatedSerials("dev1", passType, null);
    expect(first.status).toBe(200);
    const listed = (await first.json()) as { serialNumbers: string[]; lastUpdated: string };
    expect(listed.serialNumbers).toEqual([serialNumber]);
    expect((await svc.updatedSerials("dev1", passType, listed.lastUpdated)).status).toBe(204);
    expect((await svc.updatedSerials("otro", passType, null)).status).toBe(204);

    const pass = await svc.latestPass(req(auth), passType, serialNumber);
    expect(pass.status).toBe(200);
    expect(pass.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const lastModified = pass.headers.get("last-modified")!;
    expect((await svc.latestPass(req(auth, undefined, { "if-modified-since": lastModified }), passType, serialNumber)).status).toBe(304);
    expect((await svc.latestPass(req(null), passType, serialNumber)).status).toBe(401);

    // Un sello cambia la marca: el dispositivo la verá en la siguiente consulta.
    const { addStamp } = await import("@/server/stamp-card/cards");
    await addStamp(org, cardId, { userId: null, source: "panel", idempotencyKey: "wallet-stamp-1", now: new Date(Date.now() + 2000) });
    const after = await svc.updatedSerials("dev1", passType, listed.lastUpdated);
    expect(after.status).toBe(200);

    const del = new Request("https://crm.test/x", { method: "DELETE", headers: { authorization: auth } });
    expect((await svc.unregisterDevice(del, "dev1", passType, serialNumber)).status).toBe(200);
    expect((await svc.updatedSerials("dev1", passType, null)).status).toBe(204);
    expect((await svc.receiveLog(new Request("https://crm.test/x", { method: "POST", body: JSON.stringify({ logs: ["x"] }) }))).status).toBe(200);
  });

  it("tras un sello avisa a los iPhone y borra los tokens que Apple rechazó (D9)", async () => {
    const { syncCard } = await import("@/server/stamp-card/wallet-sync");
    const { getDb, schema } = await import("@/lib/db");
    // Sin depender de la prueba anterior: un token válido y uno que Apple rechaza.
    await getDb().delete(schema.applePassRegistration).where(eq(schema.applePassRegistration.cardId, cardId));
    await getDb()
      .insert(schema.applePassRegistration)
      .values([
        { id: "apr_ok", organizationId: org, cardId, deviceLibraryId: "dev3", pushToken: "0123456789abcdef0123" },
        { id: "apr_dead", organizationId: org, cardId, deviceLibraryId: "dev4", pushToken: "deadbeefdeadbeefdead" },
      ]);
    await getDb().update(schema.stampCard).set({ walletSyncPending: true }).where(eq(schema.stampCard.id, cardId));
    calls = [];
    expect(await syncCard(org, cardId)).toBe("done");
    const pushCall = calls.find((c) => c.path === "/v1/wallet/apple/push")!;
    expect((pushCall.body as { push_tokens: string[] }).push_tokens.sort()).toEqual(["0123456789abcdef0123", "deadbeefdeadbeefdead"]);
    const regs = await getDb().select().from(schema.applePassRegistration).where(eq(schema.applePassRegistration.cardId, cardId));
    expect(regs.map((r) => r.deviceLibraryId)).toEqual(["dev3"]);
    expect((await loadCard()).walletSyncPending).toBe(false);
  });

  it("con el central caído el sello se guarda y el aviso se reintenta (AC10)", async () => {
    const { addStamp } = await import("@/server/stamp-card/cards");
    const { syncCard, syncPending } = await import("@/server/stamp-card/wallet-sync");
    centralDown = true;
    const r = await addStamp(org, cardId, { userId: null, source: "panel", idempotencyKey: "wallet-stamp-2" });
    expect(r.status).toBe("ok");
    expect(await syncCard(org, cardId)).toBe("retry");
    expect((await loadCard()).walletSyncPending).toBe(true);
    // El temporizador espera antes de volver a intentar…
    const now = Date.now();
    expect(await syncPending({ now })).toBe(1);
    expect(await syncPending({ now: now + 1000 })).toBe(1);
    // …y cuando el central vuelve, lo entrega.
    centralDown = false;
    expect(await syncPending({ now: now + 61 * 60_000 })).toBe(0);
    expect((await loadCard()).walletSyncPending).toBe(false);
  });

  it("Google: clase y enlace por el central, y luego cada cambio por versión (AC8)", async () => {
    const { googleSaveUrl } = await import("@/server/stamp-card/google-pass");
    const { addStamp, redeemReward } = await import("@/server/stamp-card/cards");
    const { syncCard } = await import("@/server/stamp-card/wallet-sync");
    calls = [];
    expect(await googleSaveUrl(await loadCard(), await loadProgram())).toBe("https://pay.google.com/gp/v/save/jwt");
    const cls = calls.find((c) => c.path.startsWith("/v1/wallet/google/classes/"))!;
    expect(cls.method).toBe("PUT");
    expect((cls.body as { class: { programName: string; programLogo: { sourceUri: { uri: string } } } }).class.programLogo.sourceUri.uri).toMatch(
      /^https:\/\/crm\.test\/api\/wallet\/images\/logo\?/
    );
    // El premio va al frente, arriba del QR, y la versión de la clase lleva la revisión de la forma.
    expect(cls.body).toMatchObject({
      version: 1_000_000 + (await loadProgram()).version,
      class: {
        classTemplateInfo: {
          cardTemplateOverride: {
            cardRowTemplateInfos: [{ oneItem: { item: { firstValue: { fields: [{ fieldPath: "class.textModulesData['reward']" }] } } } }],
          },
        },
      },
    });
    const link = calls.find((c) => c.path === "/v1/wallet/google/save-link")!;
    expect(link.body).toMatchObject({ object_suffix: serial, object: { loyaltyPoints: { label: "Sellos", balance: { int: 2 } } } });

    const done = await addStamp(org, cardId, { userId: null, source: "panel", idempotencyKey: "wallet-stamp-3" });
    expect(done.status === "ok" && done.completed).toBe(true);
    calls = [];
    expect(await syncCard(org, cardId)).toBe("done");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe(`/v1/wallet/google/objects/${serial}`);
    expect(patch.body).toMatchObject({ loyalty_points: 3, points_label: "Sellos", message: { header: "¡Tarjeta completa!" } });
    expect((await loadCard()).googleObjectSaved).toBe(true);

    await redeemReward(org, cardId, { userId: null, source: "panel", idempotencyKey: "wallet-redeem-1" });
    calls = [];
    await syncCard(org, cardId);
    const v1 = (calls.find((c) => c.method === "PATCH")!.body as { version: number }).version;
    expect(v1).toBe((await loadCard()).passVersion);
  });

  it("editar el programa marca las tarjetas que están en un wallet (D9)", async () => {
    const { saveProgram } = await import("@/server/stamp-card/program");
    const before = await loadCard();
    const program = await loadProgram();
    await saveProgram(org, {
      name: program.name,
      stampsRequired: program.stampsRequired,
      reward: "1 café grande",
      terms: program.terms,
      color: program.color,
      minHoursBetweenStamps: program.minHoursBetweenStamps,
      joinPhrase: program.joinPhrase,
      joinReply: program.joinReply,
      status: "active",
    });
    const after = await loadCard();
    expect(after.passVersion).toBe(before.passVersion + 1);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("al central nunca le llega el nombre, el teléfono ni el token público (AC11)", async () => {
    const { publicCardUrl } = await import("@/server/stamp-card/cards");
    const token = publicCardUrl(cardId).split("/c/")[1]!;
    const sent = JSON.stringify(calls) + JSON.stringify(await (async () => {
      // Todo lo enviado en este archivo, no solo lo último.
      calls = [];
      const { buildApplePass } = await import("@/server/stamp-card/apple-pass");
      const { googleSaveUrl } = await import("@/server/stamp-card/google-pass");
      await buildApplePass(await loadCard(), await loadProgram());
      await googleSaveUrl(await loadCard(), await loadProgram());
      return calls;
    })());
    for (const forbidden of ["Luz", "Pérez", contact.phone, token]) {
      expect(sent.includes(forbidden), forbidden).toBe(false);
    }
    // El manifiesto firmado tampoco: solo nombres de archivo y hashes.
    for (const c of calls.filter((x) => x.path === "/v1/wallet/apple/sign")) {
      const manifest = Buffer.from((c.body as { manifest: string }).manifest, "base64").toString();
      expect(manifest).not.toMatch(/Luz|51900000011/);
    }
  });

  it("Resultados: tarjetas nuevas, sellos, canjes, los que volvieron y en un wallet (AC12)", async () => {
    const { resolvePeriod } = await import("@/server/analytics/period");
    const { stampCardBlock } = await import("@/server/analytics/stamp-card");
    const today = new Date().toISOString().slice(0, 10);
    const period = resolvePeriod({ from: today, to: today, timezone: "UTC" });
    const block = await stampCardBlock(org, period);
    expect(block).toMatchObject({
      newCards: { current: 1, previous: 0 },
      stamps: { current: 3, previous: 0 },
      redeems: { current: 1, previous: 0 },
      returning: { current: 1, previous: 0 },
      inWallet: 1,
      totalCards: 1,
      empty: false,
    });
  });
});
