# Tareas — 031 IA solo fuera de horario

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md).

- [x] T001 `reply_mode`, `attention_hours`, `attention_timezone` en `agent_profile`; migración `0022_attention_hours`
- [x] T002 `src/lib/attention.ts`: regla, horario por defecto y esquema
- [x] T003 Puerta en `src/server/ai/pipeline.ts` (D3, D4)
- [x] T004 `GET/PUT /api/agent/profile` con los campos nuevos y `attentionNow`
- [x] T005 Pantalla Agente: «Cuándo responde» y el horario de atención
- [x] T006 Unitarias e integración contra PostgreSQL
- [x] T007 `attentionChecks` en `scripts/e2e-selftest.mjs` y `tests/e2e/us-ai-after-hours.md`; 360 px
- [x] T008 `specs/README.md` y `CLAUDE.md`
