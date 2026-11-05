# 1019 — Manual de marca into 2026

**Created**: 2026-11-01

**Status**: Implementada; pruebas unitarias (incluidas las de contraste),
typecheck y lint en verde; revisada en pantalla en tema claro y oscuro.

**Input**: Juan Carlos el 2026-11-01: «ha cambiado el manual de marca de into,
aplícalo a into-sales e into-central». Fuente: `~/Workspace/brand/`
(`manual-de-marca-revision-2026.pdf`, `README.md`, `svg/` y `web/`). La
página 10 del manual lista lo pendiente en los repos: el azul #0070E0 y sus
variantes, verde para texto #1A7F37, texto terciario #5F6E8A, `favicon.svg` e
ícono de la app con el azul nuevo.

**Carril**: ligero. Tokens, constantes de marca e isotipo; sin migración.

## Comportamiento observable y criterios de aceptación

- **AC1 (azul, claro)** — El acento por defecto y el preset «Azul into» son
  **#0070E0** (antes #0081C8). Pasa AA con texto blanco (4,8:1), así que el
  relleno es el azul del logo tal cual. Hover y texto azul sobre tintes,
  #0063C6 y #0056AD.
- **AC2 (azul, oscuro)** — Con el azul into, el tema oscuro y la barra lateral
  azul marino usan el azul de modo oscuro del manual, **#3D9BFF**, con tinta
  casi negra #0F1419 (6,5:1). El texto azul sobre tintes es #6CB0FF (el de
  into-web), porque #3D9BFF pasa sobre el fondo pero no sobre un tinte que se
  siga distinguiendo del fondo. Los demás colores white-label se siguen
  calculando como antes.
- **AC3 (texto terciario)** — En claro, `--text-3` pasa a **#5F6E8A** (5,1:1,
  AA para texto pequeño). En oscuro no cambia (#9AA9CA).
- **AC4 (isotipo e íconos)** — La interfaz usa el isotipo a color en vector
  (`public/brand/into-isotipo.svg`, de `brand/web/`). Los PNG (256 px y los
  íconos de la app de 180/192/512 y maskable) se regeneran desde él, sobre
  blanco y con el 80 % central en el maskable.
- **AC5 (favicon)** — La pestaña de una instancia IntoSales sin logo subido usa
  el isotipo **plano**, sin sombras (`public/brand/favicon.svg`, de
  `brand/web/`).
- **AC6 (migración)** — Una marca guardada con el azul into de antes
  (#0081c8) se lee como el de ahora. Cualquier otro color elegido se respeta.
- **AC7** — El verde #33B44A solo aparece en el logotipo («sales»), donde el
  manual lo permite. Ningún texto de la interfaz lo usa.

## Qué se decidió NO hacer y por qué

- **Lema «Vende más por WhatsApp.» dentro del CRM**: el manual lo reserva para
  la página, la demo y el material de IntoSales, y el CRM es white-label.
- **Cambiar «Pipeline» por «Embudo»** (tono de voz, sin anglicismos): toca
  textos de toda la app; va en su propia spec si se pide.

## Dónde vive

`src/lib/brand.ts` (`BRAND_BLUE`, `LEGACY_BRAND_BLUE`, `BRAND_LOGO_SRC`,
`BRAND_FAVICON_SRC`) · `src/lib/branding.ts` (preset, `INTO_BLUE_DARK`,
`INTO_BLUE_NAV`, normalización) · `src/lib/favicon.ts` ·
`src/app/api/branding/favicon/route.ts` · `src/app/globals.css` ·
`public/brand/` · pruebas en `tests/unit/branding.test.ts`,
`tests/unit/theme-contrast.test.ts` y `tests/unit/favicon.test.ts`.
