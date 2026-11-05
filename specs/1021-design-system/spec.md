# 1021 — Adoptar el sistema de diseño into

**Created**: 2026-11-02

**Status**: Implementada; typecheck, lint, pruebas unitarias y `docker build`
en verde (Node 22); capturas antes y después comparadas (claro, oscuro y
teléfono).

**Input**: Juan Carlos el 2026-11-02: «into-sales e into-central usan el
sistema de diseño into-designsystem del otro hilo. Como siempre, usa
componentes reutilizables» y, el mismo día: seguir el «Plan de adopción» del
README de into-designsystem, crear primero en el sistema (con pruebas) todo
componente reutilizable que falte, no tocar el white-label y verificar con
Node 22. into-central hizo lo mismo en su spec 013.

**Carril**: ligero. Configuración, CSS y componentes; sin migración ni cambio
de aspecto.

## Comportamiento observable y criterios de aceptación

- **AC1** — El CRM se ve igual que antes (Bandeja, Embudo, Contactos, Citas,
  Resultados, Agente, Ajustes, entrada), en claro, oscuro y teléfono.
- **AC2** — El tema (variables de claro, oscuro y la barra azul marino), los
  estilos base, `.kicker`, `.brand-tile` y el fondo de la pantalla de entrada
  salen del preset `@into/designsystem/tailwind`. `globals.css` conserva solo
  lo propio del CRM: el chat, la densidad de filas y el calendario de Citas.
- **AC3** — `Button`, `Badge`, `Card*`, `Input`, `Label`, `Textarea`,
  `PasswordInput`, `EmptyState` y `Table*` son los del sistema: cada archivo
  de `src/components/ui/` los reexporta, así ningún import cambió. `Switch`
  sigue local: solo lo usa el CRM.
- **AC4** — El logotipo «intosales» (`IntoLogo`), el isotipo, el botón de tema
  (`ThemeToggle`, con la cookie `intosales-theme` y borrando la vieja
  `vocero-theme`) y la pantalla de entrada (`AuthScreen`) son los del sistema,
  los mismos de into-central.
- **AC5 (white-label)** — Una instancia rebautizada o con logo subido se ve
  como antes: su mosaico, su nombre, su acento (`accentCssVariables` sigue
  ganando al preset, también en la barra azul marino) y la descripción neutra
  en la entrada.
- **AC6** — Los avisos usan `Notice`: la franja del agente de IA, las ventanas
  cerradas del compositor, los tokens vencidos de Messenger, Instagram y
  TikTok, los avisos del webhook de WhatsApp y de Zernio, el error de borrar
  una conversación, las credenciales rechazadas de un conector y los tratos en
  otra moneda de Resultados. La actividad de Ajustes → Anuncios usa `Table*`.
- **AC7** — Las pruebas de contraste y de marca leen los tokens de
  `@into/tokens`, la única fuente.

## Qué se decidió NO hacer y por qué

- **Las tablas de Resultados y la vista previa de importar contactos a
  `Table*`**: llevan otro estilo (encabezados sin `.kicker`, números a la
  derecha, filas compactas en el diálogo); pasarlas cambiaría su aspecto.
  Las de solo lectores de pantalla (`time-bars`) tampoco lo necesitan.
- **Las tarjetas de Resultados a `StatCard`**: comparan con el periodo
  anterior y tienen otro marco; no son la misma pieza.
- **Avisos de menos de una línea dentro de otras piezas** (la ficha del
  contacto, el error de envío en una burbuja, la tarjeta de conexión con su
  botón de desconectar): su tamaño y su enlace son propios del lugar.
- **El `Switch`**: no existe en into-central; entra al sistema cuando lo use
  una segunda app.

## Notas

- La barra azul marino lleva el acento white-label con `.nav-dark.nav-dark`:
  el preset declara `.nav-dark` después, y con la misma especificidad ganaría.
- Actualizar el sistema de diseño: en into-designsystem,
  `pnpm pack:app ../into-sales` (compila, empaqueta, copia a `vendor/` e
  instala).

## Dónde vive

`vendor/` · `package.json` · `pnpm-workspace.yaml` · `Dockerfile` ·
`tailwind.config.ts` · `src/app/globals.css` · `src/components/ui/` ·
`src/components/brand-mark.tsx` · `src/components/theme-toggle.tsx` ·
`src/lib/theme.ts` · `src/lib/branding.ts` · `src/app/(auth)/layout.tsx` ·
`src/components/notices/ai-notice.tsx` · `src/components/inbox/composer.tsx` y
`delete-conversation-dialog.tsx` · `src/components/settings/` (Anuncios,
WhatsApp, Messenger, Instagram, TikTok, Zernio, conectores) ·
`src/components/results/sales-section.tsx` · pruebas en
`tests/unit/theme-contrast.test.ts` y `branding.test.ts`.
