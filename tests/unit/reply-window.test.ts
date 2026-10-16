import { describe, expect, it } from "vitest";
import { CHANNEL_ORDER } from "@/lib/channels";
import {
  aiWindowClosedMessage,
  capabilitiesFor,
  windowClosedMessage,
} from "@/server/channels/capabilities";
import { replyWindow } from "@/server/inbox/window";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-13T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("024 · quién puede escribir (replyWindow)", () => {
  it("Instagram y Messenger: dentro de 24 h escribe cualquiera, sin etiqueta", () => {
    for (const channel of ["instagram", "messenger"] as const) {
      const w = replyWindow(channel, ago(23 * HOUR), NOW);
      expect(w).toMatchObject({ standardOpen: true, operatorOpen: true, humanAgentTag: false });
      expect(w.operatorRemainingMs).toBe(7 * DAY - 23 * HOUR);
    }
  });

  it("a las 24 h exactas cierra la ventana normal y empieza la atención humana", () => {
    const before = replyWindow("instagram", ago(DAY - 1), NOW);
    expect(before).toMatchObject({ standardOpen: true, humanAgentTag: false });
    const exact = replyWindow("instagram", ago(DAY), NOW);
    expect(exact).toMatchObject({ standardOpen: false, operatorOpen: true, humanAgentTag: true });
    expect(exact.operatorRemainingMs).toBe(6 * DAY);
  });

  it("a los 7 días exactos cierra para todos", () => {
    const before = replyWindow("messenger", ago(7 * DAY - 1), NOW);
    expect(before).toMatchObject({ operatorOpen: true, humanAgentTag: true, operatorRemainingMs: 1 });
    const exact = replyWindow("messenger", ago(7 * DAY), NOW);
    expect(exact).toEqual({
      standardOpen: false,
      operatorOpen: false,
      humanAgentTag: false,
      operatorRemainingMs: 0,
    });
  });

  it("WhatsApp y TikTok no tienen extensión: cierran con su ventana", () => {
    expect(replyWindow("whatsapp", ago(23 * HOUR), NOW).operatorOpen).toBe(true);
    expect(replyWindow("whatsapp", ago(25 * HOUR), NOW)).toMatchObject({
      standardOpen: false,
      operatorOpen: false,
      humanAgentTag: false,
    });
    expect(replyWindow("tiktok", ago(47 * HOUR), NOW)).toMatchObject({
      standardOpen: true,
      operatorOpen: true,
      humanAgentTag: false,
    });
    expect(replyWindow("tiktok", ago(49 * HOUR), NOW).operatorOpen).toBe(false);
  });

  it("sin mensajes del cliente, con fecha inválida o del futuro no hay ventana", () => {
    for (const channel of CHANNEL_ORDER) {
      for (const date of [null, new Date("no es una fecha"), new Date(NOW.getTime() + HOUR)]) {
        expect(replyWindow(channel, date, NOW)).toEqual({
          standardOpen: false,
          operatorOpen: false,
          humanAgentTag: false,
          operatorRemainingMs: 0,
        });
      }
    }
  });
});

describe("024 · capacidades por canal", () => {
  it("la extensión humana es de Instagram y Messenger, 7 días", () => {
    expect(capabilitiesFor("instagram").humanAgentWindowMs).toBe(7 * DAY);
    expect(capabilitiesFor("messenger").humanAgentWindowMs).toBe(7 * DAY);
    expect(capabilitiesFor("whatsapp").humanAgentWindowMs).toBeNull();
    expect(capabilitiesFor("tiktok").humanAgentWindowMs).toBeNull();
  });

  it("solo WhatsApp dibuja su formato; las redes reciben texto plano", () => {
    expect(capabilitiesFor("whatsapp").textFormat).toBe("whatsapp");
    for (const channel of ["instagram", "messenger", "tiktok"] as const) {
      expect(capabilitiesFor(channel).textFormat).toBe("plain");
    }
  });

  it("todo canal con etiqueta de agente humano declara hasta cuándo", () => {
    for (const channel of CHANNEL_ORDER) {
      const caps = capabilitiesFor(channel);
      expect(caps.outsideWindow === "human_agent_tag").toBe(caps.humanAgentWindowMs !== null);
    }
  });

  it("los mensajes de ventana cerrada dicen el canal y el plazo", () => {
    expect(windowClosedMessage("instagram")).toContain("Instagram");
    expect(windowClosedMessage("instagram")).toContain("7 días");
    expect(windowClosedMessage("messenger")).toContain("Messenger");
    expect(aiWindowClosedMessage("instagram")).toContain("24 horas");
    expect(aiWindowClosedMessage("instagram")).toContain("una persona");
    // WhatsApp sigue pidiendo plantilla.
    expect(windowClosedMessage("whatsapp")).toContain("plantilla");
  });
});
