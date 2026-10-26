# 1009 — El CRM se instala como app en el teléfono

**Created**: 2026-10-25

**Status**: Implementada; pruebas unitarias del icono y typecheck en verde.
Pendiente: probarla en un iPhone y un Android reales contra una instancia
desplegada.

**Input**: pedido de Juan Carlos el 2026-10-25: «aplica lo mismo para
into-sales» (gemela de la spec 011 de into-central: «Agregar al inicio» como
icono de aplicación en iOS y Android).

**Carril**: ligero. Metadatos, manifiesto, iconos y una ruta pública de
icono; sin migración ni dependencias nuevas (`next/og` viene con Next).

## Problema

Con el número de WhatsApp en la Cloud API, el dueño atiende desde la bandeja
del CRM en el celular. «Añadir a pantalla de inicio» dejaba un acceso directo
con una captura o una letra, que abría dentro del navegador con su barra de
direcciones, y Android no ofrecía «Instalar app».

## Comportamiento observable y criterios de aceptación

- **AC1 (Android)** — Chrome ofrece «Instalar app» o «Añadir a pantalla de
  inicio» con el nombre de la marca de la instancia (Ajustes → Marca) y un
  icono 192/512 más uno `maskable` que los lanzadores redondos no recortan.
- **AC2 (iOS)** — Safari → Compartir → «Añadir a pantalla de inicio» propone el
  nombre de la marca y un icono de 180 px opaco (iOS pinta de negro lo
  transparente).
- **AC3 (white-label)** — El icono sigue la misma regla que el favicon: la
  marca IntoSales sin logo subido usa el isotipo de into (PNG estáticos en
  `public/brand/`); un logo subido (PNG, JPEG o SVG) se dibuja sobre blanco;
  cualquier otra instancia lleva la inicial sobre su acento. ICO y WEBP caen a
  la inicial. Al cambiar la marca cambia el `?v=`, como en el favicon.
- **AC4** — Abierta desde el icono, ocupa toda la pantalla, sin barra de
  direcciones, y empieza en `/`. La barra de estado y la del navegador toman el
  azul marino de la cabecera del CRM en el teléfono (`#070e20`).
- **AC5** — El manifiesto y `/api/branding/app-icon` son públicos, como el
  favicon: el teléfono los pide antes de que haya sesión.

## Qué se decidió NO hacer y por qué

- **Sin service worker ni modo sin conexión**: la bandeja es tiempo real (SSE);
  una copia vieja en caché enseñaría conversaciones desactualizadas.
- **Sin notificaciones push** por ahora: necesitan service worker, permisos y,
  en iOS, que la app ya esté instalada. Si hacen falta, van en su propia spec.
- **Los PNG de IntoSales parten del isotipo de 256 px**: no hay un vector
  oficial. Si llega uno, se regeneran.

## Dónde vive

`src/app/manifest.ts` · `src/app/layout.tsx` (`icons.apple`, `appleWebApp`,
`viewport.themeColor`) · `src/lib/app-icon.ts` · `src/app/api/branding/app-icon/route.tsx`
· iconos en `public/brand/` (`icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`, `apple-touch-icon.png`) · prueba en
`tests/unit/app-icon.test.ts`.
