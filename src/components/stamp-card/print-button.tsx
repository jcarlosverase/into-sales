"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Abre el diálogo de impresión del navegador (ahí se elige «Guardar como PDF»). */
export function PrintButton() {
  return (
    <Button className="no-print" variant="outline" onClick={() => window.print()}>
      <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
      Imprimir o guardar en PDF
    </Button>
  );
}
