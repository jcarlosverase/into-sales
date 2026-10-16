# Plan — 029 A quién llamar hoy

Spec: [spec.md](spec.md) · Tareas: [tasks.md](tasks.md).

## Datos

Migración aditiva `0021_follow_up` en `lead`:

| Columna | Tipo | Notas |
|---|---|---|
| `follow_up_on` | `date` NULL | Día del próximo contacto, en el calendario del negocio |
| `follow_up_note` | `text` NULL | Hasta 200 caracteres (lo valida la ruta) |

Índice `lead_org_follow_up_idx` sobre `(organization_id, follow_up_on)`.

## Piezas

| Pieza | Dónde |
|---|---|
| Fechas y orden (puros) | `src/lib/today.ts`: `addDays(iso, n)`, `followUpChoices(today)`, `PRIORITY_RANK`, `sortSection` |
| Consulta | `src/server/leads/today.ts`: `todayList(organizationId, scope, filter, now)` → secciones con totales; usa `businessTimezone()` (019), `ownLeadCondition` (022) y `notLabContact` |
| Ruta | `GET /api/today?vendedor=<userId>\|sin_asignar\|todos` — el filtro solo cuenta para supervisores |
| PATCH | `src/app/api/pipeline/leads/[id]/route.ts`: `followUpOn`, `followUpNote` |
| Pantalla | `src/app/(app)/today/page.tsx` + `src/components/today/today-client.tsx` |
| Cajón | `src/components/pipeline/follow-up-picker.tsx` en `lead-drawer.tsx` |
| Menú | `src/lib/nav.ts`: «Hoy» primero en Trabajo |

## «Sin primer contacto»

```sql
not exists (
  select 1 from message m join conversation c on c.id = m.conversation_id
  where c.contact_id = lead.contact_id and c.is_test = false and m.direction = 'out'
)
```

## Pruebas

- Unitarias: fechas (`addDays` en fin de mes y año), opciones de «Hecho»,
  orden por prioridad.
- Integración (PostgreSQL, `tests/integration`): las tres secciones, etapas
  cerradas y contactos archivados fuera, el negocio que ya escribió, el alcance
  del vendedor y los filtros del supervisor, y el día del negocio en otra zona.
- E2E (`scripts/e2e-selftest.mjs`, `todayChecks`): fijar el seguimiento desde
  el `PATCH`, verlo en «Hoy», «Hecho» con «Mañana», un lead nuevo de WhatsApp
  en «Sin primer contacto» hasta que se le contesta, y la pantalla a 360 px.
