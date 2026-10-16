import { describe, expect, it } from "vitest";
import {
  buildEvent,
  classifyResponse,
  validSignature,
  signBody,
  HEADER_DISPATCH,
  HEADER_EVENT,
  HEADER_SIGNATURE,
  HEADER_ORG,
} from "@/server/brains/contract";
import { deliver } from "@/server/brains/deliver";

/**
 * 021 — El contrato del despacho, fijado byte a byte.
 *
 * Lo que se protege: que el JSON que el CRM firma sea EXACTAMENTE este. Un
 * cerebro verifica la firma sobre el cuerpo crudo, así que reordenar una clave
 * o cambiar cómo se serializa una fecha rompe todas las instalaciones a la
 * vez, con un 401 mudo. La prueba gemela vive en el repo del cerebro
 * (nea-agent) con este mismo cuerpo y esta misma firma: cambiar un lado sin el
 * otro rompe una prueba, no una instalación.
 */

const SECRET = "llave-de-prueba-del-contrato-0001";

const BODY =
  '{"dispatchId":"dsp_prueba0000000000001","organization":{"id":"org_prueba","slug":"mi-negocio"},' +
  '"conversation":{"id":"cv_prueba","channel":"whatsapp","aiEnabled":true,"windowOpen":true,"windowExpiresAt":"2026-10-09T05:10:11.000Z"},' +
  '"contact":{"id":"ct_prueba","displayName":"Ana Pérez","identity":"5215512345678"},' +
  '"messages":[{"id":"msg_1","at":"2026-10-08T05:10:03.000Z","type":"text","text":"hola, ¿tienen el modelo azul?","mediaId":null},' +
  '{"id":"msg_2","at":"2026-10-08T05:10:11.000Z","type":"image","text":null,"mediaId":"1234567890","mimeType":"image/jpeg","caption":"este"}],' +
  '"firstMessageAt":"2026-10-08T05:10:03.000Z","lastMessageAt":"2026-10-08T05:10:11.000Z"}';

const SIGNATURE =
  "sha256=885074513a6fbd7e2d4443e7f45e3837246effed6c9efa596260057f4dd9008d";

function event() {
  return buildEvent({
    dispatchId: "dsp_prueba0000000000001",
    organization: { id: "org_prueba", slug: "mi-negocio" },
    conversation: {
      id: "cv_prueba",
      channel: "whatsapp",
      aiEnabled: true,
      windowOpen: true,
      windowExpiresAt: new Date("2026-10-09T05:10:11.000Z"),
    },
    contact: { id: "ct_prueba", displayName: "Ana Pérez", identity: "5215512345678" },
    messages: [
      {
        id: "msg_1",
        createdAt: new Date("2026-10-08T05:10:03.000Z"),
        type: "text",
        text: "hola, ¿tienen el modelo azul?",
        media: null,
      },
      {
        id: "msg_2",
        createdAt: new Date("2026-10-08T05:10:11.000Z"),
        type: "image",
        text: null,
        media: { waMediaId: "1234567890", mimeType: "image/jpeg", caption: "este" },
      },
    ],
    firstMessageAt: new Date("2026-10-08T05:10:03.000Z"),
    lastMessageAt: new Date("2026-10-08T05:10:11.000Z"),
  });
}

describe("el evento de despacho — la forma es contrato", () => {
  it("se serializa exactamente así, clave por clave", () => {
    expect(JSON.stringify(event())).toBe(BODY);
  });

  it("y se firma exactamente así", () => {
    expect(signBody(BODY, SECRET)).toBe(SIGNATURE);
    expect(signBody(JSON.stringify(event()), SECRET)).toBe(SIGNATURE);
  });

  it("un adjunto sin media id (ubicación, contacto) no lleva mimeType ni caption", () => {
    const e = buildEvent({
      ...minimumData(),
      messages: [
        {
          id: "msg_3",
          createdAt: new Date("2026-10-08T05:10:03.000Z"),
          type: "location",
          text: null,
          media: { waMediaId: null, mimeType: null, caption: null },
        },
      ],
    });
    expect(Object.keys(e.messages[0]!)).toEqual(["id", "at", "type", "text", "mediaId"]);
    expect(e.messages[0]!.mediaId).toBeNull();
  });

  it("una conversación sin entrantes viaja con la ventana cerrada y sin vencimiento", () => {
    const e = buildEvent({
      ...minimumData(),
      conversation: {
        id: "cv_x",
        channel: "messenger",
        aiEnabled: true,
        windowOpen: false,
        windowExpiresAt: null,
      },
    });
    expect(e.conversation).toEqual({
      id: "cv_x",
      channel: "messenger",
      aiEnabled: true,
      windowOpen: false,
      windowExpiresAt: null,
    });
  });

  it("no lleva nada que no sea del contrato (ni teléfono suelto, ni credenciales)", () => {
    expect(Object.keys(event())).toEqual([
      "dispatchId",
      "organization",
      "conversation",
      "contact",
      "messages",
      "firstMessageAt",
      "lastMessageAt",
    ]);
    expect(Object.keys(event().contact)).toEqual(["id", "displayName", "identity"]);
  });
});

function minimumData() {
  return {
    dispatchId: "dsp_x",
    organization: { id: "org_x", slug: null },
    conversation: {
      id: "cv_x",
      channel: "instagram" as const,
      aiEnabled: true,
      windowOpen: true,
      windowExpiresAt: new Date("2026-10-09T05:10:11.000Z"),
    },
    contact: { id: "ct_x", displayName: "X", identity: "ig:123" },
    messages: [],
    firstMessageAt: new Date("2026-10-08T05:10:03.000Z"),
    lastMessageAt: new Date("2026-10-08T05:10:03.000Z"),
  };
}

describe("la firma", () => {
  it("valida el cuerpo crudo con la llave correcta", () => {
    expect(validSignature(BODY, SECRET, SIGNATURE)).toBe(true);
  });

  it("rechaza un byte cambiado, otra llave, la firma sin prefijo y la ausente", () => {
    expect(validSignature(BODY.replace("Ana", "Ane"), SECRET, SIGNATURE)).toBe(false);
    expect(validSignature(BODY, `${SECRET}x`, SIGNATURE)).toBe(false);
    expect(validSignature(BODY, SECRET, SIGNATURE.slice("sha256=".length))).toBe(false);
    expect(validSignature(BODY, SECRET, null)).toBe(false);
    expect(validSignature(BODY, SECRET, "")).toBe(false);
  });

  it("re-serializar el JSON con otro formato NO valida: se firma el crudo", () => {
    const reformatted = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(validSignature(reformatted, SECRET, SIGNATURE)).toBe(false);
  });
});

describe("qué entiende el CRM de la respuesta del cerebro", () => {
  it.each([200, 201, 202, 204])("%i → entregado", (status) => {
    expect(classifyResponse(status)).toEqual({ ok: true });
  });

  it.each([429, 500, 502, 503, 504])("%i → se reintenta", (status) => {
    expect(classifyResponse(status)).toMatchObject({ ok: false, retryable: true });
  });

  it.each([301, 302, 400, 401, 404, 409, 422])("%i → no se reintenta", (status) => {
    expect(classifyResponse(status)).toMatchObject({ ok: false, retryable: false });
  });
});

describe("entregar — el POST firmado", () => {
  const destination = { url: "http://nea:8000/vocero/dispatch", secret: SECRET };

  it("manda el cuerpo que firma, con las cabeceras del contrato y sin seguir redirecciones", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const r = await deliver(event(), destination, { fetchImpl });
    expect(r).toEqual({ ok: true });
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0]!;
    expect(url).toBe(destination.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe(BODY);
    const headers = init.headers as Record<string, string>;
    expect(headers[HEADER_SIGNATURE]).toBe(SIGNATURE);
    expect(headers[HEADER_DISPATCH]).toBe("dsp_prueba0000000000001");
    expect(headers[HEADER_ORG]).toBe("mi-negocio");
    expect(headers[HEADER_EVENT]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sin slug, la cabecera de organización lleva el id", async () => {
    let header = "";
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)[HEADER_ORG] ?? "";
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await deliver(buildEvent(minimumData()), destination, { fetchImpl });
    expect(header).toBe("org_x");
  });

  it("un 500 es reintentable y un 422 no", async () => {
    const con = (status: number) =>
      (async () => new Response("x", { status })) as unknown as typeof fetch;
    expect(await deliver(event(), destination, { fetchImpl: con(500) })).toMatchObject({
      ok: false,
      retryable: true,
    });
    expect(await deliver(event(), destination, { fetchImpl: con(422) })).toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it("conexión rechazada → reintentable, y el motivo no trae la URL ni la llave", async () => {
    const fetchImpl = (async () => {
      throw new TypeError(`fetch failed: ECONNREFUSED ${destination.url} ${SECRET}`);
    }) as unknown as typeof fetch;
    const r = await deliver(event(), destination, { fetchImpl });
    expect(r).toEqual({
      ok: false,
      retryable: true,
      detail: "no se pudo conectar con el cerebro",
    });
  });

  it("un cerebro que no contesta a tiempo → reintentable, con el tiempo en el motivo", async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const r = await deliver(event(), destination, { fetchImpl, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect((r as { detail: string }).detail).toContain("no contestó");
  });
});
