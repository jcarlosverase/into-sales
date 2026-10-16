import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOUNDS,
  whatsappAd,
  withoutClickIdentifier,
} from "@/server/attribution/referral";
import {
  CREATIVE_MAX_BYTES,
  downloadWithRetry,
  downloadCreative,
  creativeUrlAllowed,
} from "@/server/attribution/creative";
import {
  REPAIR_EACH_MS,
  adToSave,
  createBrake,
  serializeAd,
} from "@/server/attribution/store";
import { effectiveSource } from "@/server/contact-source";
import {
  accountAsAd,
  originLabel,
  originHeadline,
} from "@/lib/ad-origin";

/**
 * 018 — De qué anuncio llegó cada conversación.
 *
 * Lo que se prueba aquí es la única puerta por la que un payload externo llega
 * a una columna (la normalización), la única por la que ese payload hace que el
 * servidor descargue algo (la URL del creativo y la descarga), y lo que decide
 * la bandera ATRIBUCION: el identificador de clic, nada más.
 */

const REFERRAL_CTWA = {
  source_url: "https://fb.me/2ZXjQ0aB1",
  source_id: "120212345678900001",
  source_type: "ad",
  headline: "Diagnóstico gratis para tu negocio",
  body: "Escríbenos y agenda tu llamada",
  media_type: "image",
  image_url: "https://scontent.xx.fbcdn.net/v/t45.1600-4/creativo.jpg?oe=66F0",
  ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO",
};

describe("whatsappAd", () => {
  it("normaliza el referral completo de un anuncio Click-to-WhatsApp", () => {
    const a = whatsappAd(REFERRAL_CTWA);
    expect(a).toMatchObject({
      sourceId: "120212345678900001",
      sourceType: "ad",
      sourceUrl: "https://fb.me/2ZXjQ0aB1",
      headline: "Diagnóstico gratis para tu negocio",
      body: "Escríbenos y agenda tu llamada",
      mediaType: "image",
      ctwaClid: REFERRAL_CTWA.ctwa_clid,
      imageUrl: REFERRAL_CTWA.image_url,
    });
    expect(a?.raw).toMatchObject({ source_id: "120212345678900001" });
  });

  it("prefiere la miniatura al creativo completo", () => {
    const a = whatsappAd({
      ...REFERRAL_CTWA,
      media_type: "video",
      video_url: "https://video.xx.fbcdn.net/v.mp4",
      thumbnail_url: "https://scontent.xx.fbcdn.net/thumb.jpg",
    });
    expect(a?.imageUrl).toBe("https://scontent.xx.fbcdn.net/thumb.jpg");
  });

  it("sin nada que identifique el anuncio no hay anuncio", () => {
    expect(whatsappAd(undefined)).toBeNull();
    expect(whatsappAd(null)).toBeNull();
    expect(whatsappAd("ad")).toBeNull();
    expect(whatsappAd([REFERRAL_CTWA])).toBeNull();
    expect(whatsappAd({})).toBeNull();
    expect(whatsappAd({ body: "solo texto", media_type: "image" })).toBeNull();
    expect(whatsappAd({ source_id: "   ", headline: "" })).toBeNull();
  });

  it("basta uno de los campos útiles, aunque falte el id del anuncio", () => {
    expect(whatsappAd({ ctwa_clid: "clid-1" })?.ctwaClid).toBe("clid-1");
    expect(whatsappAd({ headline: "Promo" })?.headline).toBe("Promo");
  });

  it("ignora tipos equivocados en vez de guardarlos", () => {
    const a = whatsappAd({ source_id: 12345, headline: { x: 1 }, ctwa_clid: "c" });
    expect(a?.sourceId).toBeNull();
    expect(a?.headline).toBeNull();
    expect(a?.ctwaClid).toBe("c");
  });

  it("solo acepta enlaces http(s): un javascript: jamás llega a un href", () => {
    const a = whatsappAd({
      ...REFERRAL_CTWA,
      source_url: "javascript:alert(1)",
      image_url: "data:image/png;base64,AAAA",
    });
    expect(a?.sourceUrl).toBeNull();
    expect(a?.imageUrl).toBeNull();
  });

  it("recorta cadenas gigantes y acota el raw", () => {
    const huge = "x".repeat(50_000);
    const a = whatsappAd({
      source_id: huge,
      headline: huge,
      body: huge,
      ctwa_clid: huge,
      campo_nuevo_de_meta: huge,
    });
    expect(a?.sourceId?.length).toBe(BOUNDS.id);
    expect(a?.headline?.length).toBe(BOUNDS.headline);
    expect(a?.body?.length).toBe(BOUNDS.text);
    expect(JSON.stringify(a?.raw).length).toBeLessThanOrEqual(BOUNDS.raw);
    // Las claves que no conoce no llegan al raw.
    expect(a?.raw).not.toHaveProperty("campo_nuevo_de_meta");
  });
});

describe("la bandera ATRIBUCION decide el identificador de clic, no el origen", () => {
  const original = process.env.ATRIBUCION;
  afterEach(() => {
    if (original === undefined) delete process.env.ATRIBUCION;
    else process.env.ATRIBUCION = original;
  });
  const ad = whatsappAd(REFERRAL_CTWA)!;

  it("apagada: se guarda el anuncio sin ctwa_clid, ni en la columna ni en el raw", () => {
    delete process.env.ATRIBUCION;
    const a = adToSave(ad);
    expect(a.ctwaClid).toBeNull();
    expect(a.raw).not.toHaveProperty("ctwa_clid");
    expect(JSON.stringify(a)).not.toContain(REFERRAL_CTWA.ctwa_clid);
    // El resto del anuncio queda intacto: el origen se ve igual.
    expect(a).toMatchObject({
      sourceId: ad.sourceId,
      headline: ad.headline,
      imageUrl: ad.imageUrl,
    });
    expect(a.raw).toMatchObject({ image_url: REFERRAL_CTWA.image_url });
  });

  it("encendida: se guarda con su ctwa_clid", () => {
    process.env.ATRIBUCION = "on";
    const a = adToSave(ad);
    expect(a.ctwaClid).toBe(REFERRAL_CTWA.ctwa_clid);
    expect(a.raw).toHaveProperty("ctwa_clid", REFERRAL_CTWA.ctwa_clid);
  });

  it("quitar el clic no toca el objeto original", () => {
    withoutClickIdentifier(ad);
    expect(ad.ctwaClid).toBe(REFERRAL_CTWA.ctwa_clid);
    expect(ad.raw).toHaveProperty("ctwa_clid");
  });

  const row = {
    id: "att_1",
    organizationId: "org_1",
    contactId: "ct_1",
    conversationId: "cv_1",
    ctwaClid: "clid-secreto",
    sourceId: "1202",
    sourceType: "ad",
    sourceUrl: "https://fb.me/x",
    headline: "Promo",
    body: "Texto",
    mediaType: "video",
    imageAssetId: null,
    raw: { ctwa_clid: "clid-secreto" },
    createdAt: new Date("2026-09-21T15:00:00Z"),
  };

  it("la tarjeta dice «Meta identificó el clic» solo con la bandera, y nunca el valor", () => {
    const on = serializeAd(row, true);
    const isOff = serializeAd(row, false);
    expect(on.hasCtwaClid).toBe(true);
    expect(isOff.hasCtwaClid).toBe(false);
    expect(serializeAd({ ...row, ctwaClid: null }, true).hasCtwaClid).toBe(false);
    for (const dto of [on, isOff]) {
      expect(JSON.stringify(dto)).not.toContain("clid-secreto");
    }
    process.env.ATRIBUCION = "on";
    expect(serializeAd(row).hasCtwaClid).toBe(true);
    delete process.env.ATRIBUCION;
    expect(serializeAd(row).hasCtwaClid).toBe(false);
  });

  it("el enlace «Ver anuncio» solo sale si es https", () => {
    expect(serializeAd(row, false).sourceUrl).toBe("https://fb.me/x");
    expect(serializeAd({ ...row, sourceUrl: "http://fb.me/x" }, false).sourceUrl).toBeNull();
  });
});

describe("creativeUrlAllowed", () => {
  it("acepta los CDN de Meta por https", () => {
    for (const u of [
      "https://scontent.xx.fbcdn.net/v/t45/creativo.jpg?oe=1",
      "https://scontent-dfw5-1.xx.fbcdn.net/x.jpg",
      "https://scontent.xx.fbcdn.net:443/x.jpg",
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      "https://scontent.cdninstagram.com/foto.jpg",
      "https://www.facebook.com/ads/image/?d=1",
    ]) {
      expect(creativeUrlAllowed(u), u).toBe(true);
    }
  });

  it("rechaza lo que convertiría la ingesta en un proxy", () => {
    for (const u of [
      "http://scontent.xx.fbcdn.net/x.jpg", // sin TLS
      "https://evilfbcdn.net/x.jpg", // no es subdominio
      "https://fbcdn.net.atacante.com/x.jpg",
      "https://user:pass@scontent.xx.fbcdn.net/x.jpg",
      "https://scontent.xx.fbcdn.net@evil.example/x.jpg",
      "https://scontent.xx.fbcdn.net:8443/x.jpg", // puerto que no es de Meta
      "https://127.0.0.1/x.jpg",
      "https://[::1]/x.jpg",
      "http://localhost:3000/api/dev/wa-mock/media-file/creativo-1",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "https://example.com/creativo.png",
      "no es una url",
      "",
    ]) {
      expect(creativeUrlAllowed(u), u).toBe(false);
    }
  });

  it("el origen del mock solo vale cuando se pasa, y exacto", () => {
    const mock = "http://localhost:3500";
    const url = "http://localhost:3500/api/dev/wa-mock/media-file/creativo-1";
    expect(creativeUrlAllowed(url)).toBe(false);
    expect(creativeUrlAllowed(url, mock)).toBe(true);
    expect(creativeUrlAllowed("http://localhost:3501/api/x", mock)).toBe(false);
    expect(creativeUrlAllowed("http://127.0.0.1:3500/api/x", mock)).toBe(false);
  });
});

describe("downloadCreative", () => {
  const META = "https://scontent.xx.fbcdn.net/v/creativo.jpg?oe=1";
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const image = (body: BodyInit = png, headers: Record<string, string> = {}) =>
    new Response(body, { headers: { "content-type": "image/png", ...headers } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Cada llamada a fetch toma la siguiente respuesta (o función) de la lista. */
  function stubFetch(...responses: (Response | (() => Promise<Response>))[]) {
    const fetchMock = vi.fn(async () => {
      const r = responses.shift();
      if (!r) throw new Error("fetch de más");
      return typeof r === "function" ? r() : r;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("baja una imagen de Meta, sin seguir redirecciones por su cuenta", async () => {
    const f = stubFetch(image());
    const d = await downloadCreative(META);
    expect(d).toMatchObject({ ok: true, mimeType: "image/png" });
    expect(d.ok && d.data.byteLength).toBe(png.byteLength);
    expect(f).toHaveBeenCalledWith(META, expect.objectContaining({ redirect: "manual" }));
  });

  it("revalida cada salto: una redirección fuera de Meta ni se pide", async () => {
    const f = stubFetch(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } })
    );
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sigue una redirección dentro de Meta", async () => {
    const f = stubFetch(
      new Response(null, { status: 301, headers: { location: "/v/otra.jpg" } }),
      image()
    );
    expect((await downloadCreative(META)).ok).toBe(true);
    expect(f).toHaveBeenLastCalledWith(
      "https://scontent.xx.fbcdn.net/v/otra.jpg",
      expect.anything()
    );
  });

  it("corta tras 3 redirecciones", async () => {
    const jump = () =>
      new Response(null, { status: 302, headers: { location: META } });
    const f = stubFetch(jump(), jump(), jump(), jump(), image());
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("solo JPEG, PNG, WebP o GIF: un SVG no pasa", async () => {
    stubFetch(image('<svg xmlns="http://www.w3.org/2000/svg"/>', { "content-type": "image/svg+xml" }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
    stubFetch(image("<html>", { "content-type": "text/html" }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
  });

  it("más de 300 KB no se descarga, lo declare o no", async () => {
    stubFetch(image(png, { "content-length": String(CREATIVE_MAX_BYTES + 1) }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });

    // Sin content-length: se corta al pasar el tope, sin leer el resto.
    let emitted = 0;
    const infinite = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 64_000;
        controller.enqueue(new Uint8Array(64_000));
      },
    });
    stubFetch(image(infinite));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
    expect(emitted).toBeLessThan(CREATIVE_MAX_BYTES + 3 * 64_000);
  });

  it("distingue lo que vale reintentar de lo que no", async () => {
    stubFetch(new Response(null, { status: 503 }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "transitoria" });
    stubFetch(new Response(null, { status: 429 }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "transitoria" });
    stubFetch(() => Promise.reject(new DOMException("timeout", "TimeoutError")));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "transitoria" });
    stubFetch(new Response(null, { status: 404 }));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
    stubFetch(image(new Uint8Array(0)));
    expect(await downloadCreative(META)).toEqual({ ok: false, failure: "permanente" });
  });

  it("un host no permitido no llega a pedirse", async () => {
    const f = stubFetch(image());
    expect(await downloadCreative("https://example.com/x.png")).toEqual({
      ok: false,
      failure: "permanente",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("reintenta una vez un fallo transitorio, y ninguna uno permanente", async () => {
    let f = stubFetch(new Response(null, { status: 503 }), image());
    expect((await downloadWithRetry(META, 0)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);

    f = stubFetch(new Response(null, { status: 503 }), new Response(null, { status: 503 }), image());
    expect((await downloadWithRetry(META, 0)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);

    f = stubFetch(new Response(null, { status: 404 }), image());
    expect((await downloadWithRetry(META, 0)).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("freno de la reparación", () => {
  it("como mucho un intento por anuncio cada 10 minutos", () => {
    const brake = createBrake();
    const t0 = 1_000_000;
    expect(brake.tryKey("org:ad1", t0)).toBe(true);
    expect(brake.tryKey("org:ad1", t0 + 1)).toBe(false);
    expect(brake.tryKey("org:ad1", t0 + REPAIR_EACH_MS - 1)).toBe(false);
    // Otro anuncio no espera al primero.
    expect(brake.tryKey("org:ad2", t0 + 1)).toBe(true);
    // Pasada la ventana, se vuelve a intentar.
    expect(brake.tryKey("org:ad1", t0 + REPAIR_EACH_MS)).toBe(true);
  });

  it("purga las claves vencidas para no crecer sin fin", () => {
    const brake = createBrake(1_000, 3);
    for (const k of ["a", "b", "c"]) brake.tryKey(k, 0);
    expect(brake.keys).toBe(3);
    brake.tryKey("d", 5_000);
    expect(brake.keys).toBe(1);
  });
});

describe("fuente y etiquetas", () => {
  it("lo capturado manda sobre el anuncio", () => {
    expect(effectiveSource("referido", true)).toEqual({
      value: "referido",
      source: "capturada",
    });
  });

  it("sin captura, un anuncio deduce la fuente", () => {
    expect(effectiveSource(null, true)).toEqual({ value: "anuncio", source: "deducida" });
    expect(effectiveSource(null)).toEqual({ value: "desconocida", source: "deducida" });
  });

  it("una publicación se enseña pero no cuenta como anuncio", () => {
    expect(accountAsAd({ sourceType: "post" })).toBe(false);
    expect(accountAsAd({ sourceType: "ad" })).toBe(true);
    expect(accountAsAd({ sourceType: null })).toBe(true);
    expect(accountAsAd(null)).toBe(false);
    expect(originLabel("post")).toBe("Publicación");
    expect(originLabel("ad")).toBe("Anuncio");
    expect(originHeadline(null, "ad")).toBe("Anuncio sin título");
    expect(originHeadline("Promo", "post")).toBe("Promo");
  });
});
