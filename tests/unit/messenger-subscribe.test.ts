import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";

/**
 * Spec 1010: guardar la conexión de Messenger (modo Meta) suscribe la página a
 * la app. Sin eso, Meta no entrega ningún mensaje aunque el webhook de la app
 * esté bien puesto. Nunca lanza: guardar no puede fallar por Meta.
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const { subscribePageToApp } = await import("@/server/messenger/subscribe");

beforeEach(() => graphRequest.mockReset());

describe("subscribePageToApp", () => {
  it("suscribe la página con el campo messages y el token de la página", async () => {
    graphRequest.mockResolvedValue({ success: true });
    await expect(subscribePageToApp("PAGE-1", "page-token")).resolves.toEqual({ ok: true });
    expect(graphRequest).toHaveBeenCalledWith("PAGE-1/subscribed_apps", {
      method: "POST",
      token: "page-token",
      body: { subscribed_fields: "messages" },
    });
  });

  it("sin pages_manage_metadata lo dice con el permiso que falta", async () => {
    graphRequest.mockRejectedValueOnce(
      new MetaApiError("(#200) Permissions error", { status: 403, code: 200 })
    );
    const res = await subscribePageToApp("PAGE-1", "page-token");
    expect(res).toMatchObject({ ok: false, code: "missing_permission" });
    expect(!res.ok && res.message).toContain("pages_manage_metadata");
  });

  it("token vencido, Meta caída y otros errores tienen su código y no lanzan", async () => {
    graphRequest.mockRejectedValueOnce(new MetaApiError("bad", { status: 401, code: 190 }));
    await expect(subscribePageToApp("P", "t")).resolves.toMatchObject({ code: "invalid_token" });

    graphRequest.mockRejectedValueOnce(new MetaApiError("down", { status: 0 }));
    await expect(subscribePageToApp("P", "t")).resolves.toMatchObject({ code: "meta_unavailable" });

    graphRequest.mockRejectedValueOnce(new MetaApiError("(#100) Invalid parameter", { status: 400, code: 100 }));
    const res = await subscribePageToApp("P", "t");
    expect(res).toMatchObject({ code: "meta_error" });
    expect(!res.ok && res.message).toContain("Invalid parameter");
  });
});
