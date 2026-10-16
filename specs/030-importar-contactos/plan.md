# Plan — 030 Importar contactos

Spec: [spec.md](spec.md) · Tareas: [tasks.md](tasks.md).

Sin migración.

## Piezas

| Pieza | Dónde |
|---|---|
| Leer el archivo (puro) | `src/lib/import/csv.ts` (separador, comillas, BOM, UTF-8/Latin-1) · `src/lib/import/xlsx.ts` (zip con `node:zlib`, `sharedStrings.xml`, la primera hoja) · `src/lib/import/table.ts` (`readTable(bytes, fileName)` → filas de texto) |
| Reglas (puras) | `src/lib/import/rules.ts`: `guessMapping(headers)`, `normalizeImportPhone(raw, countryCode)`, `countryCodeFor(currency)`, `planImport(rows, mapping, options, existing)` → filas con estado |
| Servidor | `src/server/contacts-import.ts`: `previewImport` y `runImport` (usa `createLeadForContact` de 022 para el lead y el turno) |
| Rutas | `POST /api/contacts/import/preview` y `POST /api/contacts/import` (`multipart/form-data`: `file`, `mapping` JSON, `countryCode`, `assign`) |
| Pantalla | `src/components/contacts/import-dialog.tsx`, botón «Importar» en `contacts-client.tsx` |

## Estados de una fila

`ok` · `exists` (ya es contacto) · `duplicate` (repetido en el archivo) ·
`invalid_phone`. Las filas vacías se descartan al leer y no cuentan.

## Asignación (D5)

| Quién importa | `assign` | Lead |
|---|---|---|
| Vendedor | (ignorado) | `assignedUserId = él` |
| Supervisor | `turno` (defecto) | Siguiente en el turno (022) |
| Supervisor | `user:<id>` | Ese vendedor (debe ser del equipo; si no, 422) |
| Supervisor | `ninguno` | Sin asignar |

«Sin asignar» con el turno encendido no pasa por el turno: se crea el lead y se
deja `assigned_user_id` en `NULL`.

## Pruebas

- Unitarias: CSV (coma, punto y coma, comillas, saltos dentro de comillas, BOM,
  Latin-1), `.xlsx` (con `tests/fixtures/contacts.xlsx`, generado con
  `zipfile` de Python: cadenas compartidas, en línea y números), encabezados,
  teléfonos y el plan con existentes y repetidos.
- Integración (PostgreSQL): importar crea contactos y leads, respeta etapa,
  asignación y existentes, y repetir no crea nada.
- E2E (`scripts/e2e-selftest.mjs`, `importChecks`): vista previa y importación
  de un CSV y un `.xlsx` por la API, el diálogo a 360 px.
