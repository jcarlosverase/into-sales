# Tareas — 1023 Tarjeta de sellos virtual

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md).

## Corte 1 — Tarjeta web

- [x] T001 Cuatro tablas en `src/lib/db/schema.ts`; `pnpm db:generate` → `drizzle/0027_stamp_card.sql`
- [x] T002 Bandera `STAMP_CARD`: `src/server/stamp-card/flag.ts`, `src/lib/env.ts` y `.env.example`
- [x] T003 `src/lib/stamp-card.ts`: esquema, `normalizePhrase`, `canStamp`, `applyStamp`, `applyRedeem` y `renderJoinReply`, con sus unitarias
- [x] T004 Generador de QR (SVG) y decisión sobre la dependencia: propio, sin dependencia (`src/lib/qr.ts`)
- [x] T005 `src/server/stamp-card/program.ts` y `cards.ts` (transacciones, idempotencia, tokens), con integración contra PostgreSQL
- [x] T006 API del panel: programa, crear tarjeta, sellar, canjear, ajustar y bitácora (AC2, AC5, AC6)
- [x] T007 Frase de alta en `src/server/inbox/ingest.ts` antes del turno y del despacho (AC3)
- [x] T008 Página pública `(public)/c/[token]` con límite por IP y `noindex` (AC4)
- [x] T009 `(app)/s/[serial]` para sellar desde el QR (AC7)
- [x] T010 Ajustes → Tarjeta de sellos: formulario, vista previa, cartel y enlace NFC (AC13)
- [x] T011 Panel de la tarjeta en el cajón del trato y en la Bandeja (AC14)
- [x] T012 `scripts/e2e-stamp-card.mjs` (corte 1) y `tests/e2e/us-stamp-card.md`; 360 px

Notas del corte 1 (2026-11-05):

- El aviso por WhatsApp al completar la tarjeta (D10, opcional y apagado por
  defecto) no estaba en ninguna tarea. Se hizo con el corte 3 (T025).
- Verificación humana del corte 1: escanear el cartel impreso con un iPhone y
  un Android, y grabar el enlace en un sticker NFC.

## Corte 2 — Apple Wallet

- [x] T013 `src/server/central/wallet.ts` y el mock `api/dev/central-mock/wallet/*` con camino infeliz
- [x] T014 Imágenes del pase (`images.ts`) e `apple-pass.ts`: `pass.json`, manifiesto, firma y zip «store»
- [x] T015 Servicio web de Apple en `/api/wallet/apple/v1/*` (AC9), con integración
- [x] T016 `wallet-sync.ts` y su temporizador: avisos por APNs y reintentos (D9, AC10)
- [x] T017 Botón «Agregar a Apple Wallet» según `walletAvailability()` (AC8)
- [x] T018 Prueba de que ningún cuerpo al central lleva datos personales (AC11)

## Corte 3 — Google, Resultados y agente

- [x] T019 `google-pass.ts`: clase y objeto; enlace y actualización por el central (AC8)
- [x] T020 Sección «Tarjeta de sellos» en Resultados (AC12)
- [x] T021 Contexto de la tarjeta en `src/server/ai/prompts.ts` (H7)
- [x] T022 Chequeo `stamp_card` en el doctor y en Salud
- [x] T023 E2E completo con el mock del central; `specs/README.md`, `CLAUDE.md` y `AGENTS.md` (mapa)
- [ ] T024 Verificación humana: iPhone real y Google Wallet con una cuenta de prueba contra el central de desarrollo
- [x] T025 Aviso por WhatsApp al completar (D10): interruptor y plantilla en Ajustes, `src/server/stamp-card/complete.ts`

Notas de los cortes 2 y 3 (2026-11-05):

- Migración aditiva `0028`: `stamp_card.google_link_issued_at`. Desde que se
  da el enlace de Google, cada cambio se pasa al central; `google_object_saved`
  queda para lo que dice el central (la ficha muestra «en su wallet»).
- El objeto de Google lleva solo los sellos y el QR: el contrato del central
  solo deja actualizar los puntos, así que una imagen o un texto con los
  sellos quedarían viejos. Premio y condiciones van en la clase.
- Sin `APP_BASE_URL` https:// no hay servicio web de Apple (el pase no se
  actualiza solo) ni Google Wallet (Google baja el logo del CRM).
- T024 sigue pendiente: es la verificación humana con un iPhone y un Android.

