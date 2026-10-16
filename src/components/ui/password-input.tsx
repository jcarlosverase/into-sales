"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Campo de contraseña con el botón para mostrarla u ocultarla (spec 1003).
 * El botón no envía el formulario (`type="button"`), dice su estado a los
 * lectores de pantalla (`aria-pressed` y la etiqueta) y mide 36 px: se toca
 * bien en el celular.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentPropsWithRef<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        aria-controls={props.id}
        data-testid="password-toggle"
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-text-3 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
