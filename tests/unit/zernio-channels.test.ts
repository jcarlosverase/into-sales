import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidZernioSignatureAny } from "@/server/zernio";
import {
  accountHealth,
  pickZernioAccount,
  zernioAccountName,
  type ZernioAccount,
} from "@/server/zernio/accounts";
import {
  coversAccount,
  pointsHere,
  webhookHealth,
  type ZernioWebhook,
} from "@/server/zernio/webhooks";
import { webhookAccountIds } from "@/server/zernio/connections";

// Forma real de GET /accounts (2026-10-13): un perfil con sus tres redes.
const PROFILE = "68d2d7be1ca85e7dbf120b4e";
const IG = "6ace6b7c2195810407a1a80b";
const FB = "6a8fd28677555aae01e8712b";
const TT = "6ace6bfe5d6259b1df1e1bf2";
const accounts: ZernioAccount[] = [
  {
    _id: FB,
    platform: "facebook",
    username: "kevinbelier",
    displayName: "Kevin Belier",
    profileId: { _id: PROFILE },
    metadata: { selectedPageId: "620183174507365", selectedPageName: "Kevin Belier" },
    isActive: true,
    platformStatus: "active",
  },
  {
    _id: IG,
    platform: "instagram",
    username: "kevinbelier.ia",
    platformUserId: "24851359284498146",
    profileId: { _id: PROFILE },
    isActive: true,
    platformStatus: "active",
  },
  {
    _id: TT,
    platform: "tiktok",
    username: "kevin.belier",
    profileId: { _id: PROFILE },
    isActive: true,
    platformStatus: "active",
    tiktokAccountType: "personal",
  },
];

describe("zernio · qué cuenta se está conectando (D1)", () => {
  it("el id de una cuenta del canal se acepta tal cual", () => {
    const r = pickZernioAccount(accounts, IG, "instagram");
    expect(r.ok && r.account._id).toBe(IG);
  });

  it("sin id y con una sola cuenta del canal, se toma esa", () => {
    const ig = pickZernioAccount(accounts, "", "instagram");
    const fb = pickZernioAccount(accounts, null, "messenger");
    const tt = pickZernioAccount(accounts, undefined, "tiktok");
    expect(ig.ok && ig.account._id).toBe(IG);
    expect(fb.ok && fb.account._id).toBe(FB);
    expect(tt.ok && tt.account._id).toBe(TT);
  });

  it("sin id y con varias, pide elegir y dice cuáles hay", () => {
    const other: ZernioAccount = { _id: "otra-ig", platform: "instagram", username: "cliente" };
    const r = pickZernioAccount([...accounts, other], "", "instagram");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("choose_account");
    expect(r.candidates).toEqual([
      { id: IG, name: "@kevinbelier.ia" },
      { id: "otra-ig", name: "@cliente" },
    ]);
  });

  it("el id del PERFIL se traduce a la cuenta del canal", () => {
    const ig = pickZernioAccount(accounts, PROFILE, "instagram");
    const fb = pickZernioAccount(accounts, PROFILE, "messenger");
    expect(ig.ok && ig.account._id).toBe(IG);
    expect(fb.ok && fb.account._id).toBe(FB);
  });

  it("el id del perfil no vale si dentro hay dos cuentas del canal", () => {
    const other: ZernioAccount = { _id: "otra-ig", platform: "instagram", profileId: PROFILE };
    const r = pickZernioAccount([...accounts, other], PROFILE, "instagram");
    expect(r.ok).toBe(false);
  });

  it("la cuenta de otra red se rechaza diciendo cuáles sirven", () => {
    const r = pickZernioAccount(accounts, FB, "instagram");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("unknown_account");
    expect(r.message).toContain(IG);
  });

  it("un id que no existe no se guarda", () => {
    const r = pickZernioAccount(accounts, "nada", "instagram");
    expect(!r.ok && r.code).toBe("unknown_account");
  });

  it("una llave sin cuentas del canal lo dice, con o sin id", () => {
    const soloFb = accounts.filter((c) => c.platform === "facebook");
    for (const ref of ["", IG]) {
      const r = pickZernioAccount(soloFb, ref, "instagram");
      expect(!r.ok && r.code).toBe("unknown_account");
      expect(!r.ok && r.candidates).toEqual([]);
    }
  });

  it("con muchas cuentas la lista se corta y el mensaje lo dice", () => {
    const many: ZernioAccount[] = Array.from({ length: 12 }, (_, i) => ({
      _id: `ig-${i}`,
      platform: "instagram",
      username: `cuenta${i}`,
    }));
    const r = pickZernioAccount(many, "", "instagram");
    expect(!r.ok && r.candidates.length).toBe(8);
    const outside = pickZernioAccount(many, "nada", "instagram");
    expect(!outside.ok && outside.message).toContain("y 4 más");
  });

  it("el nombre es el que una persona reconoce", () => {
    expect(zernioAccountName(accounts[0]!)).toBe("Kevin Belier");
    expect(zernioAccountName(accounts[1]!)).toBe("@kevinbelier.ia");
    expect(zernioAccountName({ _id: "x", platform: "facebook", username: "pagina" })).toBe("pagina");
    expect(zernioAccountName({ _id: "x", platform: "tiktok" })).toBe("x");
  });
});

describe("zernio · salud de la cuenta", () => {
  const healthy = accounts[1]!;

  it("una cuenta activa está bien", () => {
    expect(accountHealth(healthy, "instagram").level).toBe("ok");
  });

  it("una que ya no aparece con esa llave es un error", () => {
    expect(accountHealth(null, "instagram").level).toBe("error");
  });

  it("pedir reconexión, estar desactivada o restringida son errores", () => {
    expect(accountHealth({ ...healthy, needsReconnection: true }, "instagram").level).toBe("error");
    expect(accountHealth({ ...healthy, isActive: false }, "instagram").level).toBe("error");
    expect(accountHealth({ ...healthy, enabled: false }, "instagram").level).toBe("error");
    expect(
      accountHealth({ ...healthy, messagingRestriction: { reason: "x" } }, "instagram").level
    ).toBe("error");
  });

  it("un TikTok personal es un error: no recibe mensajes por API", () => {
    const h = accountHealth(accounts[2]!, "tiktok");
    expect(h.level).toBe("error");
    expect(h.message).toContain("Business");
    expect(accountHealth({ ...accounts[2]!, tiktokAccountType: "business" }, "tiktok").level).toBe("ok");
  });

  it("un estado raro de la plataforma o un acceso vencido son avisos", () => {
    expect(accountHealth({ ...healthy, platformStatus: "limited" }, "instagram").level).toBe("warn");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(accountHealth({ ...healthy, tokenExpiresAt: yesterday }, "instagram").level).toBe("warn");
    expect(accountHealth({ ...healthy, tokenExpiresAt: tomorrow }, "instagram").level).toBe("ok");
  });
});

describe("zernio · un webhook, un secreto, varios canales (D3)", () => {
  const body = '{"event":"message.received"}';
  const signature = (s: string) => createHmac("sha256", s).update(body).digest("hex");

  it("vale si coincide con cualquiera de los secretos", () => {
    expect(isValidZernioSignatureAny(body, signature("bueno"), ["viejo", "bueno"])).toBe(true);
  });

  it("con secretos configurados, una firma ajena o ausente se rechaza", () => {
    expect(isValidZernioSignatureAny(body, signature("ajeno"), ["viejo", "bueno"])).toBe(false);
    expect(isValidZernioSignatureAny(body, null, ["bueno"])).toBe(false);
  });

  it("sin secretos la capa queda apagada", () => {
    expect(isValidZernioSignatureAny(body, null, [])).toBe(true);
  });
});

describe("zernio · el webhook hacia esta instancia", () => {
  const SEGMENT = "seg-secreto-123";
  const here = `https://crm.ejemplo.com/api/webhooks/ig/${SEGMENT}`;
  const w = (over: Partial<ZernioWebhook> = {}): ZernioWebhook => ({
    _id: "w1",
    name: "vocero-crm.ejemplo.com",
    url: here,
    secret: "s",
    events: ["message.received"],
    isActive: true,
    accountIds: [IG, FB],
    failureCount: 0,
    lastFiredAt: "2026-10-13T20:00:00.000Z",
    ...over,
  });

  it("apunta aquí solo si su URL lleva el segmento secreto como tramo entero", () => {
    expect(pointsHere(w(), SEGMENT)).toBe(true);
    expect(pointsHere(w({ url: "https://otro.com/api/webhooks/ig/otro-segmento" }), SEGMENT)).toBe(false);
    // Un segmento que solo es prefijo de otro no cuenta.
    expect(pointsHere(w({ url: `${here}-mas` }), SEGMENT)).toBe(false);
    expect(pointsHere(w({ url: "no es una url" }), SEGMENT)).toBe(false);
    expect(pointsHere(w(), "")).toBe(false);
  });

  it("cubre una cuenta si está activo, con el evento y con la cuenta dentro", () => {
    expect(coversAccount(w(), IG)).toBe(true);
    expect(coversAccount(w(), TT)).toBe(false);
    expect(coversAccount(w({ accountIds: [] }), TT)).toBe(true); // sin límite
    expect(coversAccount(w({ isActive: false }), IG)).toBe(false);
    expect(coversAccount(w({ events: ["post.published"] }), IG)).toBe(false);
  });

  it("salud: sin webhook, desactivado, sin la cuenta, con fallos y bien", () => {
    expect(webhookHealth([], SEGMENT, IG).level).toBe("error");
    expect(
      webhookHealth([w({ url: "https://otro.com/api/webhooks/ig/x" })], SEGMENT, IG).level
    ).toBe("error");
    expect(webhookHealth([w({ isActive: false })], SEGMENT, IG).message).toContain("desactivado");
    expect(webhookHealth([w()], SEGMENT, TT).message).toContain("no incluye esta cuenta");
    expect(
      webhookHealth([w({ events: ["post.published"] })], SEGMENT, IG).message
    ).toContain("message.received");

    const withFailures = webhookHealth([w({ failureCount: 3 })], SEGMENT, IG);
    expect(withFailures.level).toBe("warn");
    expect(withFailures.failureCount).toBe(3);

    const good = webhookHealth([w()], SEGMENT, IG);
    expect(good).toMatchObject({ level: "ok", lastFiredAt: "2026-10-13T20:00:00.000Z" });
  });

  it("un webhook desactivado no tapa a otro activo que sí cubre la cuenta", () => {
    const h = webhookHealth([w({ _id: "viejo", isActive: false }), w({ _id: "nuevo" })], SEGMENT, IG);
    expect(h.level).toBe("ok");
  });
});

describe("zernio · qué cuentas lleva el webhook de una llave", () => {
  const ig = { accountRef: IG };
  const fb = { accountRef: FB };
  const tt = { accountRef: TT };

  it("una sola llave: todas las cuentas conectadas", () => {
    expect(webhookAccountIds([ig, fb, tt], [ig, fb, tt], new Set([IG, FB, TT]))).toEqual([IG, FB, TT]);
  });

  it("dos llaves de la MISMA cuenta de Zernio: cada una deja el webhook con todas", () => {
    // Se rotó la llave y solo se reconectó Instagram: las dos ven lo mismo.
    const allOnes = new Set([IG, FB, TT]);
    expect(webhookAccountIds([ig, fb, tt], [ig], allOnes)).toEqual([IG, FB, TT]);
    expect(webhookAccountIds([ig, fb, tt], [fb, tt], allOnes)).toEqual([IG, FB, TT]);
  });

  it("dos cuentas de Zernio distintas: cada llave, solo las suyas", () => {
    expect(webhookAccountIds([ig, fb, tt], [ig], new Set([IG]))).toEqual([IG]);
    expect(webhookAccountIds([ig, fb, tt], [fb, tt], new Set([FB, TT]))).toEqual([FB, TT]);
  });

  it("si la llave no ve ninguna, van las de su grupo", () => {
    expect(webhookAccountIds([ig, fb], [ig], new Set())).toEqual([IG]);
  });

  it("nunca incluye cuentas que no están conectadas a la organización", () => {
    expect(webhookAccountIds([ig], [ig], new Set([IG, "cuenta-de-un-cliente"]))).toEqual([IG]);
  });
});
