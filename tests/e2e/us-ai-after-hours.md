# Guion E2E · La IA responde solo fuera de horario (spec 031)

Automatizado en `scripts/e2e-selftest.mjs` (`attentionChecks`), con el ai-mock.
La regla (bordes, varios tramos, zona horaria) se prueba en
`tests/unit/attention.test.ts`; la puerta con el perfil y la zona de la base,
en `tests/integration/attention.test.ts`.

1. `PUT /api/agent/profile` rechaza un horario al revés y una zona inventada
   (422); por defecto la IA responde siempre (AC1, AC3).
2. Con el agente encendido, «Solo fuera del horario de atención» y atención
   todo el día: `attentionNow` es verdadero y un WhatsApp nuevo no recibe
   respuesta de la IA, sin quedar traspasado (AC2, D3).
3. En ese mismo estado, una corrida del Laboratorio termina con puntaje: la IA
   contesta en el Laboratorio a cualquier hora (AC4).
4. Sin horario de atención: `attentionNow` es falso y un WhatsApp nuevo sí
   recibe respuesta de la IA (AC2).
5. La pantalla Agente, a 360 px, dice que ahora contesta la IA y no tiene
   scroll horizontal (AC5). Al final se deja todo como estaba.
