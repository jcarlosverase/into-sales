import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Notice } from "@into/designsystem";
import type { NoticeIa } from "@/server/ai/notice";

/**
 * La franja que dice que el agente no puede contestar (issue #85). Spec 1021:
 * es el `Notice` en franja del sistema de diseño.
 *
 * Sin descartar. Un banner que se cierra es un banner que se cierra una vez y
 * nunca se vuelve a ver, y esto no es una novedad: es que el producto no está
 * haciendo lo que el dueño cree que hace. Se va solo cuando se arregla.
 */
export function NoticeIaBanner({ notice: notice }: { notice: NoticeIa }) {
  if (!notice) return null;
  return (
    <Notice
      layout="banner"
      tone="warning"
      icon={Sparkles}
      data-aviso-ia
      className="flex-wrap items-center gap-x-3 gap-y-1.5"
      action={<Link href="/settings/ai">{notice.action} →</Link>}
    >
      {notice.message}
    </Notice>
  );
}
