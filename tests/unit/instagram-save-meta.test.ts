import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 1011: con el inicio de sesión de Instagram, `/me` trae `id`
 * (app-scoped) y `user_id` (IG_ID, el de los webhooks). Guardar la conexión en
 * modo Meta tiene que guardar el IG_ID, aceptar el campo vacío y no rechazar a
 * quien pega el IG_ID del panel.
 */

const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
}));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => true,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByOrg: async () => null,
  saveInstagramCredentials: save,
  tokenLast4: (t: string) => t.slice(-4),
}));

const { PUT } = await import("@/app/api/settings/instagram/route");

const IG_ID = "17841400000000001";
const APP_SCOPED = "26000000000000002";
const fetchMock = vi.fn();

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request("https://crm.test/api/settings/instagram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "meta", token: "IGAA-token", ...body }),
    })
  );

beforeEach(() => {
  save.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: APP_SCOPED, user_id: IG_ID, username: "negocio" }), {
      status: 200,
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("PUT /api/settings/instagram — modo Meta", () => {
  it("pide user_id a /me y guarda el IG_ID aunque no se pegue ninguno", async () => {
    const res = await put({});
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/me?fields=user_id,username");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ igUserId: IG_ID, username: "negocio" }));
  });

  it("acepta el IG_ID del panel", async () => {
    expect((await put({ igUserId: IG_ID })).status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ igUserId: IG_ID }));
  });

  it("acepta el id app-scoped de antes, pero guarda el IG_ID", async () => {
    expect((await put({ igUserId: APP_SCOPED })).status).toBe(200);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ igUserId: IG_ID }));
  });

  it("rechaza un ID de otra cuenta", async () => {
    const res = await put({ igUserId: "999" });
    expect(res.status).toBe(422);
    expect(save).not.toHaveBeenCalled();
  });
});
