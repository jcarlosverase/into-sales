# Pruebas de seguridad en el CI

Cuatro checks en cada PR, en cada push a `main` y los lunes por la mañana
(spec [1005](../specs/1005-security-scans/spec.md)). Cada uno sale con su nombre
en el PR, así se sabe de entrada qué falló.

| Check | Qué mira | Falla cuando… |
|---|---|---|
| `codeql` | El código TypeScript y los workflows (SAST) | hay un hallazgo de gravedad **alta** o **crítica** (por ahora solo informa, ver abajo) |
| `gitleaks` | Secretos en los commits del PR | aparece **cualquier** secreto |
| `dependencies` | CVEs en las dependencias (`pnpm audit`) | hay una vulnerabilidad **crítica** en producción (por ahora solo informa) |

Mientras se revisan los hallazgos de la primera corrida (spec 1005, D1),
`codeql` y `dependencies` salen en verde aunque encuentren algo: el paso que
fallaría lleva `continue-on-error` y deja un aviso amarillo con la tabla en el
resumen. Al resolverlos, se quita y pasan a bloquear.
| `zap baseline` | Lo que responde el CRM a alguien sin cuenta (DAST) | salta una regla `FAIL` de `.zap/rules.tsv` |

## Dónde ver los resultados

En el PR, **Details** del check → la corrida en Actions. Arriba de la página
está el **resumen** (Summary) con una tabla por herramienta: gravedad, regla,
archivo y línea. Abajo, en **Artifacts**, quedan los reportes completos:

- `codeql-sarif` y el SARIF de Gitleaks: se abren con la extensión «SARIF
  Viewer» de VS Code, que lleva a la línea.
- `zap-report`: `zap-report.html` se abre en el navegador; cada alerta dice
  qué URL, qué se vio y cómo corregirlo.

into-sales es público, así que CodeQL también aparece en Security → Code
scanning, con cada alerta y su historial (salvo en PRs desde un fork, que no
pueden subir).

## Qué hacer cuando falla

- **codeql**: abre el archivo y la línea de la tabla. La regla (p. ej.
  `js/sql-injection`) se busca en <https://codeql.github.com/codeql-query-help/>
  con su explicación y ejemplos. Si tras revisarlo no es un problema real,
  agrégalo como `--accept regla@ruta` en `.github/workflows/security-sast.yml`
  con un comentario que diga por qué. Nunca sin el porqué.
- **gitleaks**: un secreto en un commit ya es público para quien tenga el
  repo. **Primero revócalo** (BotFather, el proveedor de la llave, etc.),
  después sácalo del código. Solo si es un falso positivo (un ejemplo, un
  valor de prueba), copia la huella (`Fingerprint`) que imprime el job a
  `.gitleaksignore` con un comentario.
- **dependencies**: la tabla del resumen dice en qué versión se corrige. Sube
  el paquete (`pnpm up paquete@versión`) o, si viene por otro, el que lo trae.
  El informe también lista altas y moderadas: no bloquean, pero conviene
  planearlas.
- **zap baseline**: el resumen trae cada alerta con su id (p. ej. `[10038]`).
  Las `WARN` son mejoras conocidas; una `FAIL` es una regresión. Si corriges
  una `WARN`, pásala a `FAIL` en `.zap/rules.tsv` para que no vuelva.

## Probar en local

```bash
# CodeQL: con el CLI de https://github.com/github/codeql-action/releases
codeql database create /tmp/db --language=javascript-typescript --source-root=.
codeql database analyze /tmp/db codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
  --format=sarif-latest --output=codeql.sarif
node scripts/sarif-summary.ts --title CodeQL --fail-on high codeql.sarif

# Gitleaks
gitleaks git . --redact

# Dependencias
pnpm audit --prod --audit-level critical

# ZAP: la app en localhost:3000 (pnpm start o docker compose con el override)
docker compose -p sales-dast -f docker-compose.yml -f docker-compose.dast.yml up -d --build --wait app
mkdir -p zap && cp .zap/rules.tsv zap/ && chmod 777 zap
docker run --rm --network host -v "$PWD/zap:/zap/wrk:rw" zaproxy/zap-stable:2.17.0 \
  zap-baseline.py -t http://localhost:3000 -c rules.tsv -I -r zap-report.html
```

## Lo que encontró la primera corrida

En la spec [1005](../specs/1005-security-scans/spec.md#lo-que-encontró-la-primera-corrida-2026-10-17).
