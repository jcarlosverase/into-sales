# Guion E2E · Tarjeta de sellos, corte 1 (spec 1023)

Automatizado en `scripts/e2e-stamp-card.mjs`. Lee de `/api/health` si
`STAMP_CARD` está encendida y corre la parte que toca: el CI lo corre en
`default` (apagada) y en `completo` (encendida). Las reglas de sellos, canje,
ajuste e idempotencia se prueban además contra PostgreSQL en
`tests/integration/stamp-card.test.ts`, y el QR en `tests/unit/qr.test.ts`.

## Con la bandera apagada (AC1)

1. `/api/stamp-card/*`, el cartel y `/api/wallet/apple/*` responden 404.
2. `/c/<token>`, `/s/<serial>` y el cartel para imprimir dan 404 incluso sin
   sesión (no mandan a «Entrar»). Ajustes → Tarjeta de sellos da 404 con
   sesión y no aparece en el menú.
3. La frase de alta por WhatsApp no crea tarjetas.

## Con la bandera encendida

1. **AC2** — `PUT /api/stamp-card/program` rechaza 31 sellos y una respuesta
   sin `{enlace}` con 422, y guarda un programa válido (3 sellos, 4 horas
   entre sellos).
2. **AC3** — Un WhatsApp (wa-mock) con «¡Quiero mi TARJETA de sellos!» recibe
   «Hola <nombre>, tu tarjeta de <negocio>: <enlace>». La IA no contesta ese
   mensaje; repetir la frase reenvía el mismo enlace y no crea otra tarjeta.
   Control: un mensaje normal del mismo cliente sí lo contesta la IA.
3. **AC5** — Sin `Idempotency-Key` es 422. Dos sellos a la vez con la misma
   llave suman uno. El segundo sello antes de 4 horas responde 409
   `needs_confirmation`; con `force` suma. El tercero completa la tarjeta.
4. **AC6** — Canjear antes de completar es 409; completo, vuelve a 0 y cuenta
   un canje. La bitácora tiene alta, tres sellos y el canje, con quién. El
   dueño ajusta sellos.
5. **AC4** — `/c/<token>` a 360 px: negocio, sellos y premio, sin nombre ni
   teléfono del cliente, `noindex`, con el QR y sin scroll horizontal. Un
   token inválido es 404.
6. **AC7** — `/s/<serial>` sin sesión va a «Entrar» sin mostrar la tarjeta, y
   después de entrar vuelve a ella. «Sumar sello» pide confirmar (freno de
   horas) y queda registrado como sellado con el QR; con la tarjeta completa
   aparece «Canjear premio». Cabe a 360 px.
7. **AC13** — Ajustes → Tarjeta de sellos abre con su entrada en el menú y
   muestra el enlace `wa.me` con la frase para el sticker NFC. El cartel se
   descarga en PNG y la versión para imprimir abre.
8. **AC14** — La ficha del contacto en la Bandeja muestra la tarjeta (3/3) y
   canjea desde ahí.
9. En pausa, sellar responde 409 `program_paused`.

## Verificación humana pendiente

- Escanear el cartel impreso con la cámara de un iPhone y de un Android:
  abre WhatsApp con la frase escrita.
- Grabar el enlace en un sticker NFC NTAG213 y acercar el celular.
