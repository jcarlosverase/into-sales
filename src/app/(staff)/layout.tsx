/**
 * 1023, D6 — Pantallas del equipo que se abren desde un QR (`/s/<serial>`).
 * Sin el menú del CRM: es una pantalla de mostrador, a lo ancho del teléfono.
 * La bandera y la sesión las revisa cada página, que sabe a dónde volver.
 */
export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4">{children}</div>
    </main>
  );
}
