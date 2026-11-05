import { notFound } from "next/navigation";
import { StampCardSettings } from "@/components/settings/stamp-card-form";
import { canConfigure } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import { stampCardEnabled } from "@/server/stamp-card/flag";
import { businessWhatsAppDigits, getProgram, programDefaults } from "@/server/stamp-card/program";

export const dynamic = "force-dynamic";

/** 1023, H1 y AC13 — Solo existe con la bandera STAMP_CARD. */
export default async function StampCardSettingsPage() {
  if (!stampCardEnabled()) notFound();
  const session = await requireSession();
  const [program, defaults, phone, branding] = await Promise.all([
    getProgram(session.organizationId),
    programDefaults(session.organizationId),
    businessWhatsAppDigits(session.organizationId),
    getBranding(session.organizationId),
  ]);
  return (
    <StampCardSettings
      initial={
        program
          ? {
              name: program.name,
              stampsRequired: program.stampsRequired,
              reward: program.reward,
              terms: program.terms,
              color: program.color,
              minHoursBetweenStamps: program.minHoursBetweenStamps,
              joinPhrase: program.joinPhrase,
              joinReply: program.joinReply,
              status: program.status === "paused" ? "paused" : "active",
            }
          : defaults
      }
      saved={!!program}
      canEdit={canConfigure(session.role)}
      whatsAppDigits={phone}
      branding={{ name: branding.name, accent: branding.accent, favicon: branding.favicon }}
    />
  );
}
