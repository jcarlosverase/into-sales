import { notFound } from "next/navigation";
import { CentralClient } from "@/components/settings/central-client";
import { centralEnabled } from "@/server/central/flag";

export const dynamic = "force-dynamic";

/** 028 — Solo existe con la bandera INTO_CENTRAL_URL (conector opcional). */
export default function CentralSettingsPage() {
  if (!centralEnabled()) notFound();
  return <CentralClient />;
}
