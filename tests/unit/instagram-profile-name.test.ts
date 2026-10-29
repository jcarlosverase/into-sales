import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 1015: un DM de Instagram (app propia de Meta) llega con el nombre de
 * quien escribe, no como «Contacto de Instagram». El perfil se consulta solo
 * mientras el contacto no exista o siga con el nombre de respaldo.
 */

const ingest = vi.hoisted(() => vi.fn(async () => {}));
const needsName = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/server/inbox/ingest", () => ({ ingestInboundMessage: ingest }));
vi.mock("@/server/inbox/identity", () => ({ IG_PREFIX: "ig:", socialContactNeedsName: needsName }));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByAccountRef: async () => null,
  getInstagramCredentialsByIgUserId: async () => ({
    id: "c1",
    organizationId: "org_a",
    source: "meta",
    igUserId: "17841419419364642",
    token: "IGAA-token",
  }),
}));

const { processMetaInstagramPayload } = await import("@/server/instagram/ingest");
const { fetchInstagramProfileName } = await import("@/server/instagram/send");

const fetchMock = vi.fn();
const reply = (data: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }));
const payload = {
  object: "instagram",
  entry: [
    {
      id: "17841419419364642",
      messaging: [{ sender: { id: "IGSID-1" }, timestamp: 1_700_000_000_000, message: { mid: "m1", text: "Hola" } }],
    },
  ],
};
const creds = { source: "meta", token: "IGAA-token" } as Parameters<typeof fetchInstagramProfileName>[0];

beforeEach(() => {
  ingest.mockClear();
  needsName.mockReset().mockResolvedValue(true);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchInstagramProfileName", () => {
  it("usa el nombre; si no hay, el @usuario", async () => {
    reply({ name: " Juan Carlos ", username: "jcarlosveraseac" });
    expect(await fetchInstagramProfileName(creds, "IGSID-1")).toBe("Juan Carlos");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/IGSID-1?fields=name,username");

    reply({ username: "jcarlosveraseac" });
    expect(await fetchInstagramProfileName(creds, "IGSID-1")).toBe("@jcarlosveraseac");
  });

  it("si Meta no lo da, null sin lanzar; con Zernio ni pregunta", async () => {
    reply({ error: { message: "nope", code: 100 } }, 400);
    expect(await fetchInstagramProfileName(creds, "IGSID-1")).toBeNull();
    expect(await fetchInstagramProfileName({ ...creds, source: "zernio" }, "IGSID-1")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("processMetaInstagramPayload", () => {
  it("contacto nuevo o con nombre de respaldo: ingiere con el nombre del perfil", async () => {
    reply({ name: "Juan Carlos", username: "jcarlosveraseac" });
    await processMetaInstagramPayload(payload);
    expect(needsName).toHaveBeenCalledWith("org_a", "instagram", "ig:IGSID-1");
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ profileName: "Juan Carlos" }) })
    );
  });

  it("contacto con nombre propio: no consulta el perfil", async () => {
    needsName.mockResolvedValue(false);
    await processMetaInstagramPayload(payload);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ profileName: null }) })
    );
  });
});
