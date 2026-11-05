import { Check, Gift } from "lucide-react";
import { readableInk } from "@/lib/branding";
import { cn } from "@/lib/utils";

/**
 * 1023, D11 — La cara de la tarjeta de sellos: la misma en la página pública,
 * en la pantalla del equipo y en la vista previa de Ajustes. El fondo es el
 * color del programa (un dato del negocio, no un token del tema) y la tinta se
 * elige por contraste. Sin datos del cliente (D5).
 */
export function StampCardFace({
  name,
  reward,
  color,
  stamps,
  stampsRequired,
  logo,
  paused = false,
  className,
}: {
  name: string;
  reward: string;
  color: string;
  stamps: number;
  stampsRequired: number;
  logo?: React.ReactNode;
  paused?: boolean;
  className?: string;
}) {
  const ink = readableInk(color);
  const shown = Math.min(stamps, stampsRequired);
  const complete = stamps >= stampsRequired;
  // Hasta 5 por fila: 10 sellos quedan en dos filas como la tarjeta de cartón.
  const columns = Math.min(5, stampsRequired);
  return (
    <section
      aria-label={`Tarjeta de sellos de ${name}`}
      className={cn("w-full overflow-hidden rounded-2xl p-5 shadow-lg", className)}
      style={{ backgroundColor: color, color: ink }}
    >
      <header className="flex items-center gap-3">
        {logo}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">{name}</h1>
      </header>

      <p className="mt-4 text-3xl font-bold tabular-nums" aria-live="polite">
        {shown}
        <span className="text-lg font-medium opacity-80">/{stampsRequired} sellos</span>
      </p>

      <ol
        className="mt-4 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {Array.from({ length: stampsRequired }, (_, i) => {
          const on = i < shown;
          return (
            <li
              key={i}
              className="mx-auto flex aspect-square w-full max-w-12 items-center justify-center rounded-full border-2"
              style={{
                borderColor: ink,
                backgroundColor: on ? ink : "transparent",
                color: color,
                opacity: on ? 1 : 0.55,
              }}
            >
              {on ? <Check className="h-1/2 w-1/2" strokeWidth={3} /> : null}
            </li>
          );
        })}
      </ol>

      <p className="mt-4 flex items-center gap-2 text-sm font-medium">
        <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          {complete ? "¡Completaste tu tarjeta! Premio: " : "Premio: "}
          {reward}
        </span>
      </p>
      {paused ? <p className="mt-2 text-sm opacity-90">La tarjeta está en pausa: por ahora no se suman sellos.</p> : null}
    </section>
  );
}
