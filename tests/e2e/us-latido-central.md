# Guion E2E · Latido al servicio central (spec 028)

Automatizado en `scripts/e2e-selftest.mjs` (`centralChecks`). Con la bandera
apagada, el guion comprueba el paso 1; con
`INTO_CENTRAL_URL=<APP_BASE_URL>/api/dev/central-mock` y los mocks
encendidos, todos. El final de la llave elige la respuesta del mock: `…0000`
→ 401, `…5000` → 500, `…9999` → cuenta suspendida, el resto → 200 con el plan
`CE-PYM` «Pyme».

1. **Apagado** (sin `INTO_CENTRAL_URL`): `/api/health` dice
   `features.central: false`; `/api/settings/central` y `/settings/central`
   responden 404 (AC1).
2. **Encendido sin llave**: `features.central: true`; la pantalla pide la
   llave y no sale ningún latido (AC2).
3. Una llave con otro formato da 422 y el mock no recibe nada (AC4).
4. Una llave válida late en ese momento: «Plan» muestra «Pyme», `CE-PYM`,
   «Activa», la hora y `••••XXXX` (AC3). El cuerpo que recibió el mock trae
   solo `app_version`, `app_commit`, `app_started_at` y los chequeos
   `database`, `media_dir`, `whatsapp`, `ai` y `dispatch` con su estado, sin la
   llave (AC5).
5. Una llave que el central rechaza se guarda y «Plan» dice que el central no
   la reconoce (AC4).
6. Con el central respondiendo 500, la respuesta llega igual con «Sin
   respuesta del central» y la bandeja sigue respondiendo (AC6).
7. Una cuenta suspendida se ve como «Suspendida» y el CRM no limita nada.
8. A 360 px, «Plan» se lee entero y sin scroll horizontal; la llave no está
   en el HTML (AC5, AC9).
9. «Quitar» borra la llave y lo del último latido (AC7).

Prueba en vivo (fuera del arnés): con into-central corriendo en local y una
llave emitida por su panel, `INTO_CENTRAL_URL=http://localhost:3001` (into-central
en su puerto local; into-sales en el 3000); el
cliente aparece «Sano» en el panel del central con la versión del CRM.
