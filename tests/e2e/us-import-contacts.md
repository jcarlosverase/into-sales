# Guion E2E · Importar contactos (spec 030)

Automatizado en `scripts/e2e-selftest.mjs` (`importChecks`). Las reglas de cada
fila, el turno y la asignación se prueban contra PostgreSQL en
`tests/integration/import.test.ts`; la lectura de CSV y `.xlsx`, en
`tests/unit/import.test.ts` (con `tests/fixtures/contacts.xlsx`).

1. Un `.xls` se rechaza con su motivo (AC1).
2. La vista previa de un CSV separado por punto y coma adivina Nombre,
   Teléfono y Notas y cuenta: 2 entran, 1 repetido en el archivo, 1 teléfono
   inválido; no guarda nada (AC2, AC3, D6).
3. Importar crea los 2 con su lead en el Pipeline y devuelve el detalle de lo
   que no entró; repetir la importación no crea nada (AC4).
4. El `.xlsx` de las pruebas se lee (AC1).
5. En el teléfono (360 px): Contactos → «Importar», elegir un CSV, ver la
   vista previa sin scroll horizontal e importar (AC2, AC6).
