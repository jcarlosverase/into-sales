/**
 * 1023 — Páginas públicas sin sesión (la tarjeta de sellos del cliente). Sin
 * menú ni datos del CRM: solo el contenido, centrado y a lo ancho del teléfono.
 */
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5">{children}</div>
    </main>
  );
}
