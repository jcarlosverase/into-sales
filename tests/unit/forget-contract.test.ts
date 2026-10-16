import { describe, expect, it, vi } from "vitest";
import {
  HEADER_DISPATCH,
  HEADER_EVENT,
  HEADER_SIGNATURE,
  HEADER_ORG,
  buildEventForget,
  signBody,
} from "@/server/brains/contract";
import { notifyForget } from "@/server/brains/deliver";

/**
 * 026 — El contrato del olvido, fijado byte a byte.
 *
 * `CUERPO_GEMELO` y `FIRMA_GEMELA` están copiados de
 * `nea-agent/tests/test_olvido.py` (y de `tests/unit/forget-contract.test.ts`
 * de vocerocrm-cloud): es el contrato entre los repositorios. Cambiar uno
 * obliga a cambiar los otros. Si esta prueba falla, el cerebro deja de
 * entender el aviso o de aceptar su firma.
 */
const SECRET_TWIN = "secreto-gemelo-del-olvido";
const BODY_TWIN =
  '{"type":"conversation.deleted","eventId":"olv_gemelo1",' +
  '"organization":{"id":"org_gemela","slug":"gemela"},' +
  '"conversation":{"id":"cv_gemela1","channel":"whatsapp"},' +
  '"contact":{"id":"ct_gemelo1","identity":"5215550001111"},' +
  '"deletedAt":"2026-10-04T12:00:00.000Z"}';
const SIGNATURE_TWIN =
  "sha256=72adddfb8dbc0ad6f091adff55132be228ec4be16be05fb4dde9b34010b65ffa";

const event = () =>
  buildEventForget({
    eventId: "olv_gemelo1",
    organization: { id: "org_gemela", slug: "gemela" },
    conversation: { id: "cv_gemela1", channel: "whatsapp" },
    contact: { id: "ct_gemelo1", identity: "5215550001111" },
    deletedAt: new Date("2026-10-04T12:00:00.000Z"),
  });

describe("026 · el evento conversation.deleted", () => {
  it("el cuerpo es el gemelo, byte a byte y en ese orden de claves", () => {
    expect(JSON.stringify(event())).toBe(BODY_TWIN);
  });

  it("la firma es la gemela", () => {
    expect(signBody(BODY_TWIN, SECRET_TWIN)).toBe(SIGNATURE_TWIN);
  });

  it("no lleva nada de lo borrado: solo con qué encontrarlo", () => {
    expect(Object.keys(event())).toEqual([
      "type",
      "eventId",
      "organization",
      "conversation",
      "contact",
      "deletedAt",
    ]);
  });

  it("una organización sin slug viaja con slug null, no sin la clave", () => {
    const e = buildEventForget({
      eventId: "olv_1",
      organization: { id: "org_1", slug: null },
      conversation: { id: "cv_1", channel: "instagram" },
      contact: { id: "ct_1", identity: "ig:123" },
      deletedAt: new Date("2026-10-13T00:00:00.000Z"),
    });
    expect(JSON.stringify(e)).toContain('"organization":{"id":"org_1","slug":null}');
  });
});

describe("026 · avisarOlvido", () => {
  const destination = { url: "http://cerebro.test/vocero/dispatch", secret: SECRET_TWIN };

  it("manda UN POST con el cuerpo gemelo, su firma y las cabeceras del evento", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const r = await notifyForget(event(), { destination: destination, fetchImpl: fetchImpl as never });
    expect(r).toBe("avisado");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(destination.url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(BODY_TWIN);
    expect(init.redirect).toBe("manual");
    const h = init.headers as Record<string, string>;
    expect(h[HEADER_SIGNATURE]).toBe(SIGNATURE_TWIN);
    expect(h[HEADER_EVENT]).toBe("conversation.deleted");
    expect(h[HEADER_ORG]).toBe("gemela");
    // No es un despacho: no lleva su id.
    expect(h[HEADER_DISPATCH]).toBeUndefined();
  });

  it("sin slug, la cabecera de organización lleva el id", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const e = buildEventForget({
      eventId: "olv_1",
      organization: { id: "org_1", slug: null },
      conversation: { id: "cv_1", channel: "whatsapp" },
      contact: { id: "ct_1", identity: "521" },
      deletedAt: new Date(),
    });
    await notifyForget(e, { destination: destination, fetchImpl: fetchImpl as never });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)[HEADER_ORG]).toBe("org_1");
  });

  it("un cerebro que contesta 4xx o 5xx no confirmó, y NO se reintenta", async () => {
    for (const status of [400, 404, 500, 503]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      expect(await notifyForget(event(), { destination: destination, fetchImpl: fetchImpl as never })).toBe(
        "sin_confirmar"
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("un cerebro caído o que no contesta a tiempo no confirmó, y no lanza", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await notifyForget(event(), { destination: destination, fetchImpl: down as never })).toBe(
      "sin_confirmar"
    );

    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(new Error("abortado")));
        })
    );
    expect(
      await notifyForget(event(), { destination: destination, fetchImpl: slow as never, timeoutMs: 20 })
    ).toBe("sin_confirmar");
  });

  it("sin despacho no hay a quién avisar", async () => {
    const fetchImpl = vi.fn();
    expect(await notifyForget(event(), { destination: null, fetchImpl: fetchImpl as never })).toBe(
      "no_aplica"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
