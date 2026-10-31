import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 1017 — «Conectar con Instagram»: la ida lleva al inicio de sesión de
 * Instagram con un `state` en cookie; la vuelta lo comprueba, cambia el código
 * por un token de larga duración, guarda la cuenta, la suscribe al webhook y
 * vuelve a Ajustes sin código ni token en la URL.
 */

const env = vi.hoisted(() => ({
  APP_BASE_URL: "https://crm.test",
  INSTAGRAM_APP_ID: "1466292788722909" as string | undefined,
  INSTAGRAM_APP_SECRET: "ig-secret" as string | undefined,
}));
const session = vi.hoisted(() => ({ role: "owner" }));
const cookieJar = vi.hoisted(() => ({ state: "" }));
const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_a", role: session.role }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_a", role: session.role }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "intosales-ig-oauth-state" && cookieJar.state ? { value: cookieJar.state } : undefined,
  }),
}));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => true,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByOrg: async () => null,
  saveInstagramCredentials: save,
}));

const { GET: start } = await import("@/app/api/settings/instagram/oauth/start/route");
const { GET: callback } = await import("@/app/api/settings/instagram/oauth/callback/route");

const fetchMock = vi.fn();
const reply = (data: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }));
const back = (query: string) =>
  callback(new Request(`https://crm.test/api/settings/instagram/oauth/callback?${query}`));
const outcome = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("ig");

beforeEach(() => {
  session.role = "owner";
  cookieJar.state = "estado-123";
  env.INSTAGRAM_APP_ID = "1466292788722909";
  env.INSTAGRAM_APP_SECRET = "ig-secret";
  save.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ida: /oauth/start", () => {
  it("manda al inicio de sesión de Instagram con la app de Instagram y un state en cookie", async () => {
    const res = await start();
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe("1466292788722909");
    expect(to.searchParams.get("redirect_uri")).toBe("https://crm.test/api/settings/instagram/oauth/callback");
    expect(to.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    const state = to.searchParams.get("state")!;
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`intosales-ig-oauth-state=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("sin el ID o la clave de la app de Instagram: 409; sin ser propietario: 403", async () => {
    env.INSTAGRAM_APP_ID = undefined;
    expect((await start()).status).toBe(409);
    env.INSTAGRAM_APP_ID = "1466292788722909";
    session.role = "member";
    expect((await start()).status).toBe(403);
  });
});

describe("vuelta: /oauth/callback", () => {
  it("código → token largo → cuenta: guarda, suscribe y vuelve con ?ig=connected", async () => {
    reply({ data: [{ access_token: "SHORT", user_id: 111, permissions: "x" }] });
    reply({ access_token: "LONG-TOKEN", token_type: "bearer", expires_in: 5184000 });
    reply({ user_id: "17841419419364642", username: "intosales.pe", profile_picture_url: "https://cdn/p.jpg" });
    reply({ success: true });

    const res = await back("code=CODE-1%23_&state=estado-123");
    expect(outcome(res)).toBe("connected");
    expect(res.headers.get("location")).not.toMatch(/CODE|TOKEN/);

    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(exchangeUrl).toBe("https://api.instagram.com/oauth/access_token");
    const form = new URLSearchParams(String(exchangeInit.body));
    expect(form.get("code")).toBe("CODE-1"); // sin el «#_» que pega Instagram
    expect(form.get("client_secret")).toBe("ig-secret");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("grant_type=ig_exchange_token");
    expect(String(fetchMock.mock.calls[3]![0])).toContain("/me/subscribed_apps?subscribed_fields=messages");

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "meta",
        igUserId: "17841419419364642",
        username: "intosales.pe",
        token: "LONG-TOKEN",
      })
    );
  });

  it("si Meta no suscribe el webhook, queda guardada y lo dice", async () => {
    reply({ access_token: "SHORT", user_id: 111 });
    reply({ access_token: "LONG-TOKEN" });
    reply({ user_id: "17841419419364642", username: "intosales.pe" });
    reply({ error: { message: "nope", code: 10 } }, 400);
    const res = await back("code=C&state=estado-123");
    expect(outcome(res)).toBe("connected_no_webhook");
    expect(save).toHaveBeenCalled();
  });

  it("state que no coincide, cancelado o sin cookie: no guarda nada", async () => {
    expect(outcome(await back("code=C&state=otro"))).toBe("bad_state");
    expect(outcome(await back("error=access_denied&state=estado-123"))).toBe("denied");
    cookieJar.state = "";
    expect(outcome(await back("code=C&state=estado-123"))).toBe("bad_state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("Meta rechaza el código: ?ig=meta_error, sin guardar y sin el código en el log", async () => {
    reply({ error_type: "OAuthException", code: 400, error_message: "Invalid redirect_uri" }, 400);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await back("code=SECRET-CODE&state=estado-123");
    expect(outcome(res)).toBe("meta_error");
    expect(save).not.toHaveBeenCalled();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("Invalid redirect_uri");
    expect(logged).not.toContain("SECRET-CODE");
  });

  it("borra la cookie del state al terminar", async () => {
    const res = await back("code=C&state=otro");
    expect(res.headers.get("set-cookie")).toMatch(/intosales-ig-oauth-state=;.*Max-Age=0/i);
  });
});
