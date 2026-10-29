import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 1014: el webhook de Instagram (app propia de Meta) acepta la firma
 * hecha con el App Secret de la app de Meta o con la clave de la app de
 * Instagram, y un rechazo queda dicho en el log en vez de ser un 401 mudo.
 */

const env = vi.hoisted(() => ({
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-xyz",
  META_APP_SECRET: "meta-secret" as string | undefined,
  INSTAGRAM_APP_SECRET: "ig-secret" as string | undefined,
}));
const ingest = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => true,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/instagram/ingest", () => ({ processMetaInstagramPayload: ingest }));

const { POST } = await import("@/app/api/webhooks/ig/[webhookToken]/route");
const { isValidSignatureWithAny } = await import("@/server/inbox/webhook");

const body = JSON.stringify({ object: "instagram", entry: [] });
const sign = (secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
const post = (signature: string | null) =>
  POST(
    new Request("https://crm.test/api/webhooks/ig/verify-token-xyz", {
      method: "POST",
      headers: signature ? { "x-hub-signature-256": signature } : {},
      body,
    }),
    { params: Promise.resolve({ webhookToken: "verify-token-xyz" }) }
  );

beforeEach(() => {
  ingest.mockClear();
  env.META_APP_SECRET = "meta-secret";
  env.INSTAGRAM_APP_SECRET = "ig-secret";
});

describe("isValidSignatureWithAny", () => {
  it("vale con cualquiera de los secretos; sin ninguno, no se valida", () => {
    expect(isValidSignatureWithAny(body, sign("b"), ["a", "b"])).toBe(true);
    expect(isValidSignatureWithAny(body, sign("c"), ["a", "b"])).toBe(false);
    expect(isValidSignatureWithAny(body, null, [undefined, ""])).toBe(true);
  });
});

describe("POST /api/webhooks/ig — firma de Meta", () => {
  it("acepta la firma con la clave de la app de Instagram", async () => {
    expect((await post(sign("ig-secret"))).status).toBe(200);
    expect(ingest).toHaveBeenCalled();
  });

  it("sigue aceptando la del App Secret de Meta", async () => {
    expect((await post(sign("meta-secret"))).status).toBe(200);
  });

  it("rechaza otra firma y lo dice en el log, sin el secreto", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(sign("otra"))).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    const text = warn.mock.calls.flat().join(" ");
    expect(text).toContain("INSTAGRAM_APP_SECRET");
    expect(text).not.toContain("ig-secret");
    warn.mockRestore();
  });

  it("sin INSTAGRAM_APP_SECRET se valida solo con META_APP_SECRET", async () => {
    env.INSTAGRAM_APP_SECRET = undefined;
    expect((await post(sign("meta-secret"))).status).toBe(200);
    expect((await post(sign("ig-secret"))).status).toBe(401);
  });
});
