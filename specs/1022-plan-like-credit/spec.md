# 1022 — Ajustes → Plan igual que en IntoCredit

**Created**: 2026-11-04

**Status**: Implementada; typecheck, lint, pruebas unitarias y self-test E2E
completo en verde (Node 22). Escrita junto con la implementación.

**Input**: Juan Carlos el 2026-11-04: «homologa las opciones de ajustes - plan
entre sales y credit, me gusta más la de credit».

**Carril**: ligero, con una migración aditiva (`0026`: dos columnas y un valor
más en un `check`). Cambia la pantalla de la spec 028 y suma un campo al
latido, que into-central ya acepta (su spec 014).

## Qué cambia

La pantalla de IntoCredit (su spec 003) es la referencia. El estado de la
licencia pasa a ser un componente del sistema de diseño, `LicenseStatus`, que
usan las dos apps: así no se vuelven a separar.

- **AC1** — Ajustes → Plan tiene el título «Plan» con su explicación y la
  sección «Plan y licencia de into», como en IntoCredit.
- **AC2** — Un aviso con el resultado del último latido, con título cuando
  es un error («Llave no válida o revocada», «La llave no es de IntoSales») y,
  si falló, cuándo fue lo último aceptado. Una cuenta suspendida tiene su
  propio aviso («IntoSales sigue funcionando»).
- **AC3** — Los datos: Llave (`into_live_••••XXXX`), Cliente (el nombre en
  into), Plan (nombre y código), Cuenta, Último latido y Último latido
  aceptado, en hora de Lima.
- **AC4** — Las opciones: «Guardar y comprobar», «Comprobar ahora» (nuevo:
  `POST /api/settings/central` late en ese momento) y «Quitar la llave».
- **AC5** — El latido dice `"product": "into-sales"`. Si la llave es de otro
  producto, el central responde 403 y se guarda `otro_producto`; un 200 que
  dice otro producto cuenta igual.
- **AC6** — «Salud» dice lo mismo que Plan: los textos salen del sistema de
  diseño.

## Datos (migración `0026`)

`central_license` suma `customer_name` y `product` (del último latido
aceptado; una llave nueva los borra) y el `check` de `last_result` admite
`otro_producto`. Los valores guardados siguen en español (028);
`src/lib/central.ts` los traduce a los del sistema de diseño.

## Qué se decidió NO hacer

- **Pasar la pantalla a acciones de servidor como IntoCredit**: se ve y se
  comporta igual; cambiar cómo habla con el servidor no suma nada.
- **Mover el formulario al sistema de diseño**: cada app guarda la llave a su
  manera (acción de servidor o API); el estado sí es compartido.

## Dónde vive

`src/components/settings/central-client.tsx` · `src/lib/central.ts` ·
`src/app/api/settings/central/route.ts` (`POST`) · `src/server/central/`
(`client.ts`, `heartbeat.ts`, `license.ts`) · `src/lib/db/schema.ts` y
`drizzle/0026_central_customer_product.sql` · el mock del central en
`src/app/api/dev/central-mock/` (`…4030` → 403) · en into-designsystem:
`web/src/components/license-status.tsx`, su prueba y su historia · pruebas en
`tests/unit/central.test.ts` y `scripts/e2e-selftest.mjs` (028).
