# Guion E2E · Acerca de (spec 1000)

Automatizado en `scripts/e2e-selftest.mjs` (`aboutChecks`), en el teléfono
(360 px).

1. Desde la versión al pie de la barra lateral (en el teléfono, dentro del
   menú) se llega a `/about` (AC1).
2. Muestra la misma versión que `/api/health` (AC2).
3. Los módulos dicen lo mismo que `features` de `/api/health`: canales, agenda,
   atribución y servicio central (AC3).
4. El plan aparece solo con el servicio central encendido (AC4).
5. «Ver la licencia MIT» despliega el texto completo; los créditos nombran a
   into y a Kevin Belier (AC5).
6. Sin scroll horizontal y sin llaves en la página (AC6).
