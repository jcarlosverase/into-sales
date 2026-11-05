# 1020 — Tono del manual de marca: «Embudo» y el lema de IntoSales

**Created**: 2026-11-02

**Status**: Implementada; pruebas unitarias, typecheck y lint en verde.

**Input**: Juan Carlos el 2026-11-02 («sí»), sobre lo que la spec 1019 dejó
fuera: el lema de IntoSales en el CRM y cambiar «Pipeline» por «Embudo de
ventas». Fuente: `~/Workspace/brand/manual-de-marca-revision-2026.pdf`,
páginas 8 (tono de voz: «sin anglicismos cuando hay palabra en español
("embudo de ventas", no "pipeline")») y 9 (lemas).

**Carril**: ligero. Textos de la interfaz; sin migración. Las rutas y el código
siguen en inglés (`/pipeline`, `PipelineClient`), como pide la regla de idioma.

## Comportamiento observable y criterios de aceptación

- **AC1** — La interfaz dice «Embudo» donde decía «Pipeline»: la entrada del
  menú («Embudo»), el título de la pantalla («Embudo de ventas»), las etapas
  («Etapas del embudo», «Etapa en el embudo») y los textos de ayuda de
  Contactos, Bandeja, Ajustes → Marca y el reparto de leads.
- **AC2** — La pantalla de entrada de una instancia que se llama IntoSales
  muestra su lema, «Vende más por WhatsApp.». Una instancia rebautizada
  (white-label) conserva la descripción neutra «CRM de WhatsApp con agente de
  IA»: el lema es de IntoSales, no de su negocio.

## Qué se decidió NO hacer y por qué

- **La URL `/pipeline`**: cambiarla rompería enlaces guardados y el código va
  en inglés; lo que ve la persona es el nombre del menú y el título.
- **El prompt del agente** («Etapas del pipeline disponibles»): no se ve en la
  pantalla y cambiarlo movería respuestas del agente sin necesidad.
- **Historia** (CHANGELOG publicado, specs y guiones E2E que dicen «Pipeline»
  en sus comentarios): no cambia lo que la app hace.

## Dónde vive

`src/lib/nav.ts` · `src/components/pipeline/pipeline-client.tsx` y
`stage-manager.tsx` · `src/components/inbox/contact-panel.tsx` y
`delete-conversation-dialog.tsx` · `src/components/contacts/new-contact-dialog.tsx`
· `src/components/settings/branding-client.tsx` y `lead-routing-card.tsx` ·
`src/lib/brand.ts` (`PRODUCT_TAGLINE`) · `src/app/(auth)/layout.tsx` · prueba
en `tests/unit/nav.test.ts`.
