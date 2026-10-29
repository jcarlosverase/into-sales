import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";

/**
 * Spec 1012: guardar Messenger en modo Meta valida el token con `/me` (con un
 * token de página, `/me` es la página), no pide el nombre como condición y
 * después suscribe la página (spec 1010).
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));
const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
}));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => true,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByOrg: async () => null,
  saveMessengerCredentials: save,
  tokenLast4: (t: string) => t.slice(-4),
}));

const { PUT } = await import("@/app/api/settings/messenger/route");

const PAGE = "585413298177103";
const put = () =>
  PUT(
    new Request("https://crm.test/api/settings/messenger", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "meta", pageId: PAGE, token: "EAAG-page-token" }),
    })
  );

beforeEach(() => {
  graphRequest.mockReset();
  save.mockClear();
});

describe("PUT /api/settings/messenger — modo Meta", () => {
  it("token de la página: guarda, aunque Meta no deje leer el nombre", async () => {
    graphRequest.mockImplementation(async (path: string) => {
      if (path === "me?fields=id") return { id: PAGE };
      if (path === "me?fields=name") {
        throw new MetaApiError("(#100) Requires pages_read_engagement", { status: 400, code: 100 });
      }
      if (path === `${PAGE}/subscribed_apps`) return { success: true };
      throw new Error(`ruta inesperada: ${path}`);
    });
    const res = await put();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pageName: null, subscription: { ok: true } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ pageId: PAGE, pageName: null }));
  });

  it("guarda el nombre cuando Meta lo da", async () => {
    graphRequest.mockImplementation(async (path: string) =>
      path === "me?fields=id" ? { id: PAGE } : path === "me?fields=name" ? { name: " IntoSales " } : { success: true }
    );
    expect(await (await put()).json()).toMatchObject({ pageName: "IntoSales" });
  });

  it("un token de usuario u otra página no pasa", async () => {
    graphRequest.mockResolvedValueOnce({ id: "1234" });
    const res = await put();
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("no es de la página");
    expect(save).not.toHaveBeenCalled();
  });

  it("un token inválido dice el motivo de Meta", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("Error validating access token: Session has expired", { status: 400, code: 190 })
    );
    const res = await put();
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("Session has expired");
  });
});
