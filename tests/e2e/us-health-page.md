# Guion — 1004 salud del CRM

Spec: [specs/1004-health-page](../../specs/1004-health-page/spec.md).
Automatizado en `scripts/e2e-selftest.mjs` (`healthPageChecks`).

1. Como propietario, abrir Ajustes y tocar «Sistema → Salud»: se abre
   `/settings/health`.
2. Base de datos, migraciones, archivos y WhatsApp (con el wa-mock) en verde;
   IA, cerebro externo y central con su fila.
3. Arriba, el resumen y la hora de la verificación.
4. En la página no aparece la URL de la base ni ningún token.
5. A 360 px no hay scroll horizontal. «Verificar de nuevo» repite todo.
6. Como vendedor, la página dice que solo la ven el propietario y los
   administradores.
