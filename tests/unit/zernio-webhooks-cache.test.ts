import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedZernioWebhooks,
  forgetZernioWebhooks,
  webhookSecretsFromZernio,
  WEBHOOKS_FAIL_MS,
  WEBHOOKS_OK_MS,
  WEBHOOKS_RECHECK_MS,
} from "@/server/zernio/webhooks";

/**
 * 023 — La lectura de los webhooks de Zernio corre en la verificación de firma
 * de cada entrega: no puede convertirse en una consulta por mensaje, ni dejar
 * al CRM diez minutos rechazando entregas si el secreto cambió en Zernio.
 */

const SEGMENT = "segmento-secreto";
const TOKEN = "sk_llave-de-prueba";
const hook = (secret: string) => ({
  _id: "w1",
  url: `https://crm.ejemplo.com/api/webhooks/ig/${SEGMENT}`,
  secret,
  events: ["message.received"],
  isActive: true,
  accountIds: [],
});

let secretValue = "uno";
let down = false;
const fetchMock = vi.fn(async () => {
  if (down) return new Response("{}", { status: 503 });
  return Response.json({ webhooks: [hook(secretValue)] });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  secretValue = "uno";
  down = false;
  forgetZernioWebhooks(TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("zernio · caché de los webhooks", () => {
  it("una lectura buena sirve diez minutos", async () => {
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT)).toEqual(["uno"]);
    vi.advanceTimersByTime(WEBHOOKS_OK_MS - 1000);
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT)).toEqual(["uno"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    await webhookSecretsFromZernio(TOKEN, SEGMENT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pedir una lectura fresca no relee si la que hay tiene menos de un minuto", async () => {
    await webhookSecretsFromZernio(TOKEN, SEGMENT);
    secretValue = "dos";
    vi.advanceTimersByTime(WEBHOOKS_RECHECK_MS - 1000);
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT, WEBHOOKS_RECHECK_MS)).toEqual(["uno"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("…y sí relee pasado el minuto: así se entera de un secreto que cambió", async () => {
    await webhookSecretsFromZernio(TOKEN, SEGMENT);
    secretValue = "dos";
    vi.advanceTimersByTime(WEBHOOKS_RECHECK_MS + 1000);
    // La lectura normal sigue usando lo guardado…
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT)).toEqual(["uno"]);
    // …y la fresca trae el secreto nuevo.
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT, WEBHOOKS_RECHECK_MS)).toEqual(["dos"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un fallo se recuerda un minuto y mientras tanto vale la última lectura buena", async () => {
    await webhookSecretsFromZernio(TOKEN, SEGMENT);
    vi.advanceTimersByTime(WEBHOOKS_OK_MS + 1000);
    down = true;

    const r = await cachedZernioWebhooks(TOKEN);
    expect(r.ok).toBe(false);
    expect(r.webhooks.map((w) => w.secret)).toEqual(["uno"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Una ráfaga con Zernio caído no se vuelve una ráfaga de consultas, ni
    // siquiera pidiendo la lectura fresca.
    await cachedZernioWebhooks(TOKEN);
    await cachedZernioWebhooks(TOKEN, WEBHOOKS_RECHECK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(WEBHOOKS_FAIL_MS + 1000);
    down = false;
    expect((await cachedZernioWebhooks(TOKEN)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sin lectura previa y con Zernio caído no hay secretos (y no se inventan)", async () => {
    down = true;
    expect(await webhookSecretsFromZernio(TOKEN, SEGMENT)).toEqual([]);
  });

  it("solo cuentan los webhooks que apuntan a esta instancia", async () => {
    expect(await webhookSecretsFromZernio(TOKEN, "otro-segmento")).toEqual([]);
  });

  it("la llave no se usa como clave de la caché en claro", async () => {
    await webhookSecretsFromZernio(TOKEN, SEGMENT);
    const map = (globalThis as unknown as { __voceroZernioWebhooks: Map<string, unknown> })
      .__voceroZernioWebhooks;
    expect([...map.keys()].some((k) => k.includes(TOKEN))).toBe(false);
  });
});
