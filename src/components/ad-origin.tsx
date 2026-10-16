"use client";

import { useState } from "react";
import { ExternalLink, Megaphone } from "lucide-react";
import type { AdDto } from "@/lib/types";
import { originLabel, originHeadline } from "@/lib/ad-origin";

/**
 * 019 — Miniatura del creativo para listas y tablas (Resultados). Sin imagen,
 * o si deja de servirse, queda el megáfono en el mismo hueco para que las filas
 * no bailen.
 */
export function AdThumbnail({
  imageAssetId,
  alt,
}: {
  imageAssetId: string | null;
  alt: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!imageAssetId || broken) {
    return (
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-subtle text-text-3"
        aria-hidden
      >
        <Megaphone className="h-4 w-4" strokeWidth={1.7} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- adjunto privado servido con sesión; no hay host que optimizar
    <img
      src={`/api/media/${imageAssetId}`}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-9 w-9 shrink-0 rounded border bg-background object-cover"
    />
  );
}

/**
 * 018 — De qué anuncio llegó esta persona.
 *
 * La misma tarjeta en la bandeja y en el cajón del trato: la pregunta "¿quién
 * la trajo?" se hace en los dos sitios. Va entera o no va: una conversación
 * orgánica no enseña un hueco vacío.
 *
 * Solo lo que Meta manda en el `referral`: el nombre del anuncio, la campaña o
 * el conjunto no vienen ahí, y pedirlos exigiría la API de Marketing.
 */
export function AdOrigin({ ad: ad }: { ad: AdDto }) {
  // La imagen puede no estar (caducó antes de copiarse, host no permitido) o
  // dejar de servirse: la tarjeta sigue diciendo lo importante sin ella.
  const [brokenImage, setImageBroken] = useState(false);
  const label = originLabel(ad.sourceType);
  const headline = originHeadline(ad.headline, ad.sourceType);
  const date = new Date(ad.capturedAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      className="rounded-md border border-info-soft bg-info-tint px-3 py-2.5"
      data-anuncio-origen={ad.sourceId ?? ""}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-info-text">
        <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        {label === "Anuncio" ? "Llegó por un anuncio" : "Llegó por una publicación"}
      </p>

      <div className="mt-2 flex items-start gap-2.5">
        {ad.imageAssetId && !brokenImage && (
          // eslint-disable-next-line @next/next/no-img-element -- adjunto privado servido con sesión; no hay host que optimizar
          <img
            src={`/api/media/${ad.imageAssetId}`}
            alt={`Creativo: ${headline}`}
            loading="lazy"
            onError={() => setImageBroken(true)}
            className="h-14 w-14 shrink-0 rounded border border-info-soft bg-background object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] font-semibold leading-snug text-foreground">
            {headline}
          </p>
          {ad.body && (
            <p className="mt-0.5 line-clamp-3 break-words text-xs text-text-2">
              {ad.body}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-0.5 text-[11px] text-text-3">
        <p>
          Primer mensaje · {date}
          {ad.mediaType === "video" ? " · con video" : ""}
        </p>
        {ad.sourceId && (
          <p className="truncate font-mono" title={ad.sourceId}>
            ID {ad.sourceId}
          </p>
        )}
        {/* Solo la presencia, y solo en una instancia que atribuye: el valor
            del identificador de clic no sale del servidor. */}
        {ad.hasCtwaClid && <p>Meta identificó el clic</p>}
      </div>

      {ad.sourceUrl && (
        <a
          href={ad.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-text underline underline-offset-2 hover:text-brand"
        >
          Ver {label.toLowerCase()}
          <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
        </a>
      )}
    </div>
  );
}
