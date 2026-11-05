import { readableInk } from "@/lib/branding";
import { qrSvg } from "@/lib/qr";
import { waJoinLink } from "@/lib/stamp-card";
import { businessWhatsAppDigits, getProgram } from "./program";

export type PosterData = {
  name: string;
  reward: string;
  stampsRequired: number;
  phrase: string;
  link: string;
  color: string;
  ink: string;
  qrSvg: string;
};

/**
 * 1023, AC13 — Lo que lleva el cartel del mostrador: el QR de
 * `wa.me/<número>?text=<frase>` y la frase. Null sin programa o sin número
 * de WhatsApp conectado.
 */
export async function posterData(organizationId: string): Promise<PosterData | null> {
  const [program, digits] = await Promise.all([getProgram(organizationId), businessWhatsAppDigits(organizationId)]);
  if (!program || !digits) return null;
  const link = waJoinLink(digits, program.joinPhrase);
  return {
    name: program.name,
    reward: program.reward,
    stampsRequired: program.stampsRequired,
    phrase: program.joinPhrase,
    link,
    color: program.color,
    ink: readableInk(program.color),
    qrSvg: qrSvg(link),
  };
}
