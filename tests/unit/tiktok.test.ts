import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { CHANNEL_LABEL, CHANNEL_ORDER, isChannel } from "@/lib/channels";
import { settingsSections } from "@/lib/nav";
import {
  BSUID_PREFIX,
  FB_PREFIX,
  IG_PREFIX,
  TT_PREFIX,
  parseIdentity,
} from "@/server/inbox/identity";
import {
  MAX_TEXT_CHARS_ANY_CHANNEL,
  capabilitiesFor,
  outboundLimitMessage,
  textFits,
  textLimitMessage,
  windowClosedMessage,
  windowMsFor,
} from "@/server/channels/capabilities";
import { parseChannels } from "@/server/channels/enabled";
import { healthFeatures } from "@/server/health";
import { anotherMessageFits } from "@/server/inbox/outbound-cap";
import {
  isWindowOpen,
  windowExpiresAt,
  windowRemainingMs,
} from "@/server/inbox/window";
import { channelMark } from "@/components/channel-badge";
import { normalizeZernioTiktokEvent } from "@/server/tiktok/ingest";
import { normalizeZernioEvent as normalizeMessenger } from "@/server/messenger/ingest";
import { isValidZernioSignature } from "@/server/zernio";
import { zernioTargetChannel } from "@/server/zernio/dispatch";

const HOUR = 60 * 60 * 1000;
const ACCOUNT = "6ace6bfe5d6259b1df1e1bf2";
const SENDER = "tt-user-0001";

/** Un `message.received` de Zernio para TikTok, con la forma de su documentación. */
function event(over: Record<string, unknown> = {}) {
  return {
    id: "evt_5f8e2a1c",
    event: "message.received",
    message: {
      id: "66d4a1b2c3e4f5a6b7c8d9e1",
      conversationId: "66c3d2ae7b4f6c8d0e1f2a3b",
      platform: "tiktok",
      direction: "incoming",
      text: "Hola, ¿sigue disponible?",
      attachments: [],
      sender: { id: SENDER, name: "Jane", username: "jane_doe" },
      sentAt: "2026-10-13T12:00:00.000Z",
    },
    conversation: { id: "66c3d2ae7b4f6c8d0e1f2a3b", status: "active" },
    account: { id: ACCOUNT, accountId: ACCOUNT, platform: "tiktok" },
    ...over,
  };
}

describe("022 · TikTok en el catálogo de canales", () => {
  it("existe, va al final, se enciende con CHANNELS y tiene nombre y distintivo", () => {
    expect(isChannel("tiktok")).toBe(true);
    expect(CHANNEL_ORDER.at(-1)).toBe("tiktok");
    expect(CHANNEL_LABEL.tiktok).toBe("TikTok");
    expect(parseChannels("whatsapp,tiktok").has("tiktok")).toBe(true);
    expect(parseChannels("whatsapp,instagram,messenger").has("tiktok")).toBe(false);
    expect(parseChannels(undefined).has("tiktok")).toBe(false);
    expect(channelMark("tiktok")).not.toBeNull();
  });

  it("todo canal del catálogo tiene distintivo y capacidades: agregar uno y olvidar algo se nota aquí", () => {
    for (const channel of CHANNEL_ORDER) {
      expect(channelMark(channel), channel).not.toBeNull();
      expect(capabilitiesFor(channel).label, channel).toBe(CHANNEL_LABEL[channel]);
    }
  });

  it("/api/health lo lista solo si está encendido", () => {
    expect(healthFeatures({ CHANNELS: "tiktok" }).channels).toEqual(["whatsapp", "tiktok"]);
    expect(healthFeatures({}).channels).toEqual(["whatsapp"]);
  });

  it("Ajustes → Canales gana «TikTok» solo con el canal encendido", () => {
    const hrefs = (o: Parameters<typeof settingsSections>[0]) =>
      settingsSections(o).flatMap((s) => s.links.map((l) => l.href));
    expect(hrefs({ tiktok: true })).toContain("/settings/tiktok");
    expect(hrefs({ messenger: true })).not.toContain("/settings/tiktok");
    expect(hrefs({})).not.toContain("/settings/tiktok");
  });

  it("la identidad lleva su propio prefijo y no se confunde con un teléfono", () => {
    expect(TT_PREFIX).toBe("tt:");
    expect(new Set([TT_PREFIX, FB_PREFIX, IG_PREFIX, BSUID_PREFIX]).size).toBe(4);
    // `/api/bot/context?identity=tt:…` no debe intentar leerla como WhatsApp.
    expect(parseIdentity("tt:12345")).toBeNull();
  });
});

describe("022 · lo que TikTok impone, declarado en las capacidades", () => {
  it("ventana de 48 h sin forma de reabrir, sin adjuntos salientes ni acuses", () => {
    const caps = capabilitiesFor("tiktok");
    expect(caps.windowMs).toBe(48 * HOUR);
    expect(caps.outsideWindow).toBe("none");
    expect(caps.outboundMedia).toBe(false);
    expect(caps.deliveryReceipts).toBe(false);
    expect(windowMsFor("tiktok")).toBe(48 * HOUR);
    // Al operador se le dice qué pasa Y qué lo arregla.
    expect(windowClosedMessage("tiktok")).toContain("TikTok");
    expect(windowClosedMessage("tiktok")).toContain("vuelva a escribir");
  });

  it("los demás canales conservan su ventana de 24 h y no ganan topes", () => {
    for (const channel of ["whatsapp", "instagram", "messenger"] as const) {
      expect(windowMsFor(channel), channel).toBe(24 * HOUR);
      expect(capabilitiesFor(channel).maxOutboundPerWindow, channel).toBeNull();
    }
    // Instagram y Messenger miden en bytes; WhatsApp, en caracteres.
    expect(capabilitiesFor("instagram").maxTextChars).toBeNull();
    expect(capabilitiesFor("messenger").maxTextChars).toBeNull();
    // Sus textos de siempre no cambian.
    expect(windowClosedMessage("whatsapp")).toBe(
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
    // 024: la extensión humana tiene tope (7 días) y su propio mensaje.
    expect(windowClosedMessage("messenger")).toContain("7 días");
  });

  it("el texto se mide en CARACTERES: 6,000, y un emoji cuenta uno", () => {
    expect(textFits("tiktok", "a".repeat(6000))).toBe(true);
    expect(textFits("tiktok", "a".repeat(6001))).toBe(false);
    // 6,000 acentos son 12,000 bytes: contando bytes se rechazaría de más.
    expect(textFits("tiktok", "é".repeat(6000))).toBe(true);
    // 6,000 emojis son 12,000 unidades UTF-16: contando `.length`, también.
    expect(textFits("tiktok", "🙂".repeat(6000))).toBe(true);
    expect(textFits("tiktok", "🙂".repeat(6001))).toBe(false);
    expect(textLimitMessage("tiktok")).toContain("6,000 caracteres");
    // WhatsApp conserva su límite de siempre (4,096), ahora declarado en el
    // canal en vez de en el esquema de la API; y la API acepta hasta el mayor.
    expect(textFits("whatsapp", "a".repeat(4096))).toBe(true);
    expect(textFits("whatsapp", "a".repeat(4097))).toBe(false);
    expect(textLimitMessage("whatsapp")).toContain("4,096 caracteres");
    expect(MAX_TEXT_CHARS_ANY_CHANNEL).toBe(6000);
    // Messenger sigue midiendo en bytes.
    expect(textFits("messenger", "é".repeat(1200))).toBe(false);
    expect(textLimitMessage("messenger")).toContain("2000 bytes");
  });

  it("el tope: diez mensajes desde el último entrante, y el undécimo no cabe", () => {
    expect(capabilitiesFor("tiktok").maxOutboundPerWindow).toBe(10);
    expect(anotherMessageFits("tiktok", 0)).toBe(true);
    expect(anotherMessageFits("tiktok", 9)).toBe(true);
    expect(anotherMessageFits("tiktok", 10)).toBe(false);
    expect(anotherMessageFits("tiktok", 11)).toBe(false);
    // Un canal sin tope siempre deja pasar.
    expect(anotherMessageFits("whatsapp", 500)).toBe(true);
    expect(outboundLimitMessage("tiktok")).toContain("10 mensajes");
    expect(outboundLimitMessage("tiktok")).toContain("vuelva a escribir");
  });
});

describe("022 · la ventana se pregunta por canal", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);

  it("a las 30 horas: cerrada en WhatsApp, abierta en TikTok", () => {
    expect(isWindowOpen(ago(30), now, windowMsFor("whatsapp"))).toBe(false);
    expect(isWindowOpen(ago(30), now, windowMsFor("tiktok"))).toBe(true);
    expect(isWindowOpen(ago(49), now, windowMsFor("tiktok"))).toBe(false);
  });

  it("sin duración explícita sigue valiendo 24 h: nadie que la llamaba cambió", () => {
    expect(isWindowOpen(ago(23), now)).toBe(true);
    expect(isWindowOpen(ago(25), now)).toBe(false);
    expect(windowRemainingMs(ago(23), now)).toBe(HOUR);
    expect(isWindowOpen(null, now)).toBe(false);
  });

  it("lo que resta y cuándo vence salen de la misma duración", () => {
    expect(windowRemainingMs(ago(30), now, windowMsFor("tiktok"))).toBe(18 * HOUR);
    expect(windowRemainingMs(ago(60), now, windowMsFor("tiktok"))).toBe(0);
    expect(windowExpiresAt(ago(30), windowMsFor("tiktok"))?.toISOString()).toBe(
      new Date(now.getTime() + 18 * HOUR).toISOString()
    );
    expect(windowExpiresAt(null, windowMsFor("tiktok"))).toBeNull();
  });
});

describe("022 · normalizeZernioTiktokEvent (qué entra y qué se descarta)", () => {
  it("un texto entra con su cuenta, su remitente, su hilo, su hora y su nombre", () => {
    const [evt, ...rest] = normalizeZernioTiktokEvent(event());
    expect(rest).toHaveLength(0);
    expect(evt).toEqual({
      accountRef: ACCOUNT,
      senderId: SENDER,
      messageId: "66d4a1b2c3e4f5a6b7c8d9e1",
      text: "Hola, ¿sigue disponible?",
      type: "text",
      // La hora en que lo mandó la persona, no la de llegada: es lo que abre
      // la ventana, y una reentrega tardía no debe reabrirla.
      timestamp: String(Date.parse("2026-10-13T12:00:00.000Z") / 1000),
      profileName: "Jane",
      // El conversationId es lo ÚNICO con lo que se puede responder.
      threadRef: "66c3d2ae7b4f6c8d0e1f2a3b",
    });
  });

  it("la plataforma vale venga en la cuenta o solo en el mensaje", () => {
    const messageOnly = event({ account: { id: ACCOUNT } });
    expect(normalizeZernioTiktokEvent(messageOnly)).toHaveLength(1);
    expect(zernioTargetChannel(messageOnly)).toBe("tiktok");
    expect(zernioTargetChannel(event())).toBe("tiktok");
  });

  it("sin nombre cae al usuario con arroba; sin nada, el núcleo pone el de respaldo", () => {
    const base = event().message;
    const [withUser] = normalizeZernioTiktokEvent(
      event({ message: { ...base, sender: { id: SENDER, name: "  ", username: "@jane_doe" } } })
    );
    expect(withUser?.profileName).toBe("@jane_doe");
    const [withNothing] = normalizeZernioTiktokEvent(
      event({ message: { ...base, sender: { id: SENDER } } })
    );
    expect(withNothing?.profileName).toBeNull();
  });

  it("un adjunto sin texto entra con su tipo para que la bandeja enseñe qué llegó", () => {
    const base = event().message;
    const kind = (attachments: unknown[]) =>
      normalizeZernioTiktokEvent(event({ message: { ...base, text: null, attachments } }))[0]?.type;
    expect(kind([{ type: "image", url: "https://cdn/x.jpg" }])).toBe("image");
    expect(kind([{ type: "video", url: "https://cdn/x.mp4" }])).toBe("video");
    expect(kind([{ type: "sticker" }])).toBe("sticker");
    expect(kind([{ type: "share" }])).toBe("unsupported");
    // Ni texto ni adjunto: no hay nada que ingerir.
    expect(kind([])).toBeUndefined();
  });

  it("otra plataforma de la misma llave NO entra como TikTok, ni TikTok como Messenger", () => {
    const deInstagram = event({ account: { id: ACCOUNT, platform: "instagram" } });
    expect(normalizeZernioTiktokEvent(deInstagram)).toEqual([]);
    expect(zernioTargetChannel(deInstagram)).toBe("instagram");
    expect(normalizeMessenger(event())).toEqual([]);
    expect(zernioTargetChannel(event({ account: { id: ACCOUNT, platform: "twitter" }, message: { ...event().message, platform: "twitter" } }))).toBeNull();
  });

  it("lo que no es un mensaje que el cliente mandó se descarta", () => {
    const base = event().message;
    expect(normalizeZernioTiktokEvent(event({ event: "message.sent" }))).toEqual([]);
    expect(normalizeZernioTiktokEvent(event({ event: "comment.received" }))).toEqual([]);
    expect(
      normalizeZernioTiktokEvent(event({ message: { ...base, direction: "outgoing" } }))
    ).toEqual([]);
    expect(normalizeZernioTiktokEvent(null)).toEqual([]);
    expect(normalizeZernioTiktokEvent("basura")).toEqual([]);
  });

  it("sin cuenta, remitente o id no hay con qué enrutar, identificar ni deduplicar", () => {
    const base = event().message;
    expect(normalizeZernioTiktokEvent(event({ account: { platform: "tiktok" } }))).toEqual([]);
    expect(
      normalizeZernioTiktokEvent(event({ message: { ...base, sender: {} } }))
    ).toEqual([]);
    expect(
      normalizeZernioTiktokEvent(event({ message: { ...base, id: undefined } }))
    ).toEqual([]);
  });
});

describe("022 · la firma de Zernio es la misma que ya protege a Instagram y Messenger", () => {
  const SECRET = "secreto-del-webhook";
  const body = JSON.stringify(event());
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");

  it("válida → pasa; alterada, ausente o de otro cuerpo → no", () => {
    expect(isValidZernioSignature(body, signature, SECRET)).toBe(true);
    expect(isValidZernioSignature(body, signature.replace(/.$/, "0"), SECRET)).toBe(
      signature.endsWith("0")
    );
    expect(isValidZernioSignature(body, null, SECRET)).toBe(false);
    expect(isValidZernioSignature(body + " ", signature, SECRET)).toBe(false);
  });

  it("sin secreto configurado la capa queda apagada: protege el segmento de la URL", () => {
    expect(isValidZernioSignature(body, null, null)).toBe(true);
  });
});
