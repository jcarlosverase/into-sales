import { CHANNEL_LABEL, type Channel } from "@/lib/channels";

/**
 * 1000 — Qué módulos opcionales tiene encendidos la instancia, en palabras.
 * Recibe las mismas banderas que `/api/health` (`healthFeatures()`), así lo que
 * dice «Acerca de» es lo que hace la app.
 */
export type AboutFeatures = { agenda: boolean; channels: Channel[]; atribucion: boolean; central: boolean };

export type FeatureLine = { label: string; on: boolean; detail: string };

export function featureLines(f: AboutFeatures): FeatureLine[] {
  return [
    { label: "Canales", on: true, detail: f.channels.map((c) => CHANNEL_LABEL[c]).join(", ") },
    { label: "Agenda y citas", on: f.agenda, detail: f.agenda ? "Encendida" : "Apagada" },
    { label: "Atribución de anuncios", on: f.atribucion, detail: f.atribucion ? "Encendida" : "Apagada" },
    { label: "Servicio central de into", on: f.central, detail: f.central ? "Conectado" : "Apagado" },
  ];
}
