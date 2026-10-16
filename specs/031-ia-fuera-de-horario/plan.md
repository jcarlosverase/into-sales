# Plan — 031 IA solo fuera de horario

Spec: [spec.md](spec.md) · Tareas: [tasks.md](tasks.md).

## Datos

Migración aditiva `0022_attention_hours` en `agent_profile`:

| Columna | Tipo | Notas |
|---|---|---|
| `reply_mode` | `text` NOT NULL default `'always'`, check `always`/`outside_hours` | D1 |
| `attention_hours` | `jsonb` NULL | `{"mon":[{"start":"09:00","end":"18:00"}]}` en hora de pared; NULL = el horario por defecto |
| `attention_timezone` | `text` NULL | Zona IANA; NULL = la del negocio (`businessTimezone`, 019) |

## Piezas

| Pieza | Dónde |
|---|---|
| Regla (pura) | `src/lib/attention.ts`: `isWithinAttentionHours(now, hours, tz)`, `DEFAULT_ATTENTION_HOURS`, `attentionHoursSchema` (Zod: días, `HH:MM`, inicio < fin) |
| Puerta | `src/server/ai/pipeline.ts`: tras el interruptor, `if (!isTest && replyMode === "outside_hours" && dentro del horario) return;` |
| API | `GET/PUT /api/agent/profile`: `replyMode`, `attentionHours`, `attentionTimezone`, `attentionNow` |
| Pantalla | `src/components/agent/attention-hours.tsx` en `agent-client.tsx` |

## Pruebas

- Unitarias: dentro y fuera del horario, en el borde (inicio sí, fin no), días
  sin horario, dos tramos en un día, la zona (medianoche en Lima vs UTC) y el
  esquema Zod.
- Integración (PostgreSQL): la puerta del turno con el modo y la hora, el
  Laboratorio y el modo por defecto.
- E2E (`scripts/e2e-selftest.mjs`, `attentionChecks`): con el ai-mock, un
  horario que cubre todo el día deja sin respuesta un mensaje real; uno vacío
  (sin atención) la da; volver a «Siempre»; la pantalla a 360 px.
