# 1005 — Pruebas de seguridad en el CI (SAST y DAST)

**Created**: 2026-10-17

**Status**: Especificada antes de escribir código. Workflows probados en local
(CodeQL, Gitleaks, `pnpm audit` y ZAP baseline contra la app arrancada). Es el
gemelo de la spec 008 de into-central.

**Input**: pedido de Juan Carlos el 2026-10-17: «quiero agregar pruebas de
sast y dast. aplicando CI/CD».

**Carril**: ligero. No toca datos ni contratos; agrega checks al CI.

## Problema

El CI prueba que el CRM funciona, pero nada mira si es seguro: ni el código,
ni los secretos que se cuelan en un commit, ni las dependencias con CVEs, ni lo
que responde el servidor a alguien sin cuenta. Y el repo es público.

## Comportamiento observable y criterios de aceptación

- **AC1 (SAST, código)** — En cada PR y push a `main`, el check `codeql`
  analiza el TypeScript y los workflows con `security-extended`, sube el SARIF
  a Security → Code scanning y falla con hallazgos de gravedad alta o crítica.
- **AC2 (SAST, secretos)** — El check `gitleaks` revisa los commits del PR (o
  los del push) y falla con cualquier secreto. Los lunes revisa todo el
  historial; lo ya revisado va en `.gitleaksignore`.
- **AC3 (SAST, dependencias)** — El check `dependencies` deja el informe de
  `pnpm audit` en el resumen y falla con críticas en producción.
- **AC4 (DAST)** — El check `zap baseline` construye la imagen, la levanta
  con Docker Compose junto a PostgreSQL y corre OWASP ZAP baseline. Falla si
  salta una regla `FAIL` de `.zap/rules.tsv`.
- **AC5** — Los cuatro corren también los lunes y a mano desde Actions.
- **AC6** — `docs/security-scans.md` explica cómo leer cada resultado.

## Lo que encontró la primera corrida (2026-10-17)

- **CodeQL**: 2 críticas y 6 altas en `src/` por revisar (`js/request-forgery`
  en `src/lib/meta/client.ts:51` y `src/server/attribution/creative.ts:150`;
  `js/xss-through-dom` en `src/components/inbox/composer.tsx:310`;
  `js/tainted-format-string` en tres `console.*`; `js/user-controlled-bypass`
  en el webhook de Instagram; `js/incomplete-sanitization` en
  `scripts/reset-password.mjs`). Varias pueden ser falsos positivos (la URL de
  Graph sale de la configuración; `creative.ts` ya limita los hosts de Meta),
  pero cada una se revisa y se corrige o se acepta con su porqué.
- **dependencies**: 4 críticas, una en producción: `shell-quote` vía
  `better-auth › drizzle-kit › gel`.
- **Gitleaks**: 8 hallazgos en el historial, todos valores de prueba o de
  ejemplo; quedan en `.gitleaksignore`.
- **ZAP**: faltan CSP, `X-Frame-Options` y `X-Content-Type-Options`, y sobra
  `X-Powered-By`. Quedan en `WARN`.

## Decisiones

- **D1 — Umbrales iguales a los del central, pero CodeQL y `dependencies`
  solo informan al inicio** (decisión de Juan Carlos, 2026-10-17). Con lo de
  arriba arrancarían en rojo; mientras se revisan, sus pasos llevan
  `continue-on-error` y el check sale en verde con el aviso y la tabla en el
  resumen. Al resolverlos, se quita y bloquean como en el central. Gitleaks y
  ZAP bloquean desde el primer día.
- **D2 — ZAP baseline, no full scan**, y sin sesión iniciada; el webhook de
  Meta y `/api/bot/*` quedan para un escaneo de API.

## Qué se decidió NO hacer y por qué

- **Corregir aquí los hallazgos**: cada uno es un cambio de la app con su
  prueba; este cambio solo agrega los checks.
