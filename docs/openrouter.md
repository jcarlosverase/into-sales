# OpenRouter: configuración, modelos y cómo enseñarle al agente

Guía para into. Precios y límites revisados el 2026-11-06 en el catálogo público
y la documentación de OpenRouter: cambian, así que confírmalos antes de decidir.

## Dos formas de usar la IA

| | Plan centralizado | Plan propio (self-hosted) |
|---|---|---|
| Quién paga | into, con su cuenta de OpenRouter | El cliente, con su cuenta |
| Dónde va la llave | En el central (`OPENROUTER_API_KEY`) | En Ajustes → IA del CRM |
| Quién controla el gasto | El cupo del plan (spec 002 del central) | El límite de la llave del cliente |

## 1. Crear la organización

Usa una organización a nombre de into, con el correo de la empresa.

1. Con un correo verificado, entra a Settings → Preferences, sección
   Organization, y pulsa «Create Organization».
2. Cambia al contexto de la organización con el selector de arriba y confirma
   que dice su nombre. Lo que hagas en tu cuenta personal no cuenta para ella.
3. Compra créditos en Settings → Credits, dentro de la organización. OpenRouter
   cobra 5.5 % al comprar créditos, no por pedido.

## 2. Llaves

- Una llave para el central y otra para desarrollo, con nombres claros.
- Límite por llave: se fija con una Management Key (`settings/management-keys`)
  y los campos `limit` y `limit_reset`. Si el campo aparece en la pantalla,
  también sirve.
- Guardrails (Settings → Privacy): presupuesto mensual, lista exacta de modelos
  permitidos y Zero Data Retention. Si hay dos límites, gana el más bajo.
- Las llaves no van en el chat ni en el repositorio.

## 3. Modelos

USD por millón de tokens, entrada / salida:

| Uso | Modelo | Precio |
|---|---|---|
| Recomendado | `anthropic/claude-haiku-5.5` | 0.10 / 0.50 |
| Juez del Laboratorio (solo con `OPENROUTER_JUDGE_MODEL`, ver la sección 4) | `anthropic/claude-sonnet-5.5` | 2 / 10 |
| Más barato, para probar | `qwen/qwen3.7-flash` | 0.03 / 0.13 |
| Más barato, para probar | `deepseek/deepseek-v4-flash` | 0.09 / 0.18 |

Costo estimado con 3,500 tokens de entrada y 100 de salida por respuesta (cambia
según el tamaño de la Knowledge base): Haiku 5.5, unos USD 0.40 por 1,000
respuestas; Sonnet 5.5, unos USD 8.

El agente debe contestar siempre en JSON y un modelo barato puede fallar en eso
o inventar. Pasa cada modelo por el Laboratorio antes de usarlo.

## 4. Modelos gratuitos: Laboratorio sí con reservas, clientes no

Se puede técnicamente: `:free` funciona como cualquier otro modelo. La
recomendación es no usarlos con clientes, ni siquiera en un plan de prueba.

### Lo que dice OpenRouter

- **20 pedidos por minuto y 50 al día.** Pasan a 1,000 al día con USD 10 de
  créditos comprados.
- **Crear más llaves o cuentas no sube el límite**, y los pedidos fallidos
  también cuentan.
- **Privacidad:** OpenRouter dice que no entrena con tus datos, pero el
  proveedor del modelo es otra cosa. Los que registran o entrenan solo se usan
  si activas ese permiso en Privacy, y algunos proveedores gratuitos lo exigen.
  Revisa la política de cada modelo en su página.
- **No duran:** de los 453 modelos del catálogo, 15 son gratuitos, y alguno ya
  trae fecha de retiro (`dots-3-note-preview`, 2026-12-31).

### Para clientes: no

1. **El límite es de toda la cuenta de into.** Los 1,000 pedidos al día se
   comparten entre todos los clientes. 20 clientes en prueba con 50 mensajes al
   día ya lo agotan, y el agente de todos deja de contestar a la vez.
2. **Ahorra casi nada.** Con Haiku 5.5, una prueba de 300 respuestas cuesta unos
   USD 0.12. Es menos que el riesgo de perder a ese cliente por un mal primer
   contacto.
3. **Son conversaciones de personas reales.** Mandarlas a un proveedor que puede
   guardarlas o entrenar con ellas es un riesgo frente a la Ley 29733 y a lo que
   promete into. Además, un guardrail con Zero Data Retention los excluiría.
4. **La prueba es lo que el cliente va a comprar.** Si responde peor o se cae, se
   lleva una idea falsa del producto, y al pasar a un plan de pago el agente se
   comportaría distinto.

**Qué hacer en un plan de prueba:** usa el mismo modelo que los planes de pago,
con un cupo chico. Crea en Planes un plan centralizado con precio 0, modelo
`anthropic/claude-haiku-5.5` y, por ejemplo, 300 respuestas al mes. El gasto
queda acotado por el cupo.

### Para el Laboratorio: solo para jugar

Las personas del Laboratorio son simuladas, así que no hay datos de clientes
reales. Pero tu Knowledge base sí viaja, y hay un problema mayor: **el
Laboratorio mide el modelo con el que corre.** Si pruebas con uno gratuito y
atiendes con Haiku, el resultado no te dice cómo responderá Haiku.

Una corrida son 6 personas y unos 25 mensajes, más 6 llamadas del juez: unos 30
pedidos, o más con reintentos. Con el límite de 50 al día alcanza para una
corrida diaria. Con Haiku 5.5 esa misma corrida cuesta alrededor de USD 0.01.

Sirven para probar que el flujo funciona en desarrollo o para comparar modelos
sin gastar. Para decidir si un agente está listo, usa el modelo de producción.

### Para tus pruebas locales: 5 recomendados

Solo con datos de prueba, en tu máquina. Elegidos del catálogo del 2026-11-06 por
ser modelos generales, activos y sin fecha de retiro, y en este orden para
empezar. **Ninguno está probado con el agente:** el orden sale de sus
características, no de medir su español ni su JSON. Compáralos en el Laboratorio.

| | Modelo | Contexto | Para qué |
|---|---|---|---|
| 1 | `google/gemma-4-31b-it:free` | 256K | El primero que probaría: general, de instrucciones |
| 2 | `nvidia/nemotron-3.5-super-vl:free` | 1M | Knowledge base muy larga; también admite salida estructurada |
| 3 | `google/gemma-4-26b-a4b-it:free` | 256K | Alternativa más liviana al 1 |
| 4 | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | El más grande: de juez, o para ver un tope de calidad. Razona, así que puede tardar |
| 5 | `openrouter/free` | 200K | Solo para comprobar que el flujo funciona: elige un gratuito al azar, así que no sirve para comparar |

Descarté `dots-3-note-preview` (se retira el 2026-12-31), `flint-v1.0` (hecho para
programar), `nemotron-3.5-lightning` (muy chico) y `lfm-2.5-2.6b` (muy chico).

Cómo usarlos en local, en el `.env` de into-sales:

```bash
OPENROUTER_API_TOKEN=tu-llave-de-desarrollo
OPENROUTER_MODEL=google/gemma-4-31b-it:free
OPENROUTER_JUDGE_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

Ojo: lo guardado en Ajustes → IA manda sobre el `.env`, y entonces el juez usa ese
mismo modelo. Para tener un juez distinto, deja Ajustes → IA sin configurar en tu
entorno local.

- Usa la llave de desarrollo, nunca la del central.
- Con menos de USD 10 comprados tienes 50 pedidos al día, y cada reintento por
  JSON inválido también cuenta: una corrida del Laboratorio casi los gasta.
- No cargues conversaciones reales en tu base local mientras uses estos modelos.
- Un 429 suele ser el límite gratuito o la cola del proveedor, no un error del CRM.
- La lista cambia: revísala en [modelos gratuitos](https://openrouter.ai/collections/free-models).

## 5. Conectarlo en el CRM

- **Plan propio:** en Ajustes → IA, proveedor OpenRouter, modelo y llave.
- **Plan centralizado:** en Ajustes → IA, «Otro compatible con OpenAI», base
  `https://api.into.center` y la llave de licencia como token. El modelo lo
  decide el plan.

Pulsa «Probar conexión» y enciende el agente en Agente. En el plan centralizado,
esa prueba cuenta como un pedido del cupo.

## 6. Enseñarle a responder

No se entrena: el modelo lee lo que escribas en Agente en cada turno. Sale mejor
con reglas concretas que con textos largos.

- **Nombre y tono:** «Sofía», «cercano y directo, de usted».
- **Instrucciones:** «Máximo 3 líneas. Una pregunta a la vez. Primero averigua
  qué busca, luego da el precio. No prometas descuentos ni fechas».
- **Reglas de escalado:** cuándo pasar a una persona: reclamos, pagos,
  descuentos, enojo, o cuando no sabe.
- **Knowledge base:** es su única fuente de verdad. Una pregunta por entrada,
  escrita como la haría el cliente. Va completa en cada turno: un texto más
  largo cuesta más en cada respuesta.

El mejor material son las conversaciones reales: las preguntas que más se repiten
y la respuesta de tu mejor vendedor.

## 7. Probarlo antes de encenderlo

1. Corre las personas del Laboratorio con el modelo de producción.
2. Aplica las sugerencias del juez y repite hasta tener verde.
3. Empieza con «solo fuera del horario de atención» y lee las conversaciones de
   la primera semana. Cada respuesta mala es una entrada nueva.

## 8. Operación

- Revisa el gasto en Activity y en «Uso de IA» del central.
- Sin saldo (402), el CRM pausa el agente. **Después de recargar, pulsa «Probar
  conexión»: no vuelve solo.**
- Con un 403 o el cupo agotado, el CRM avisa sin pausar, y el aviso se va solo
  (spec 1027).

## Fuentes

- [Límites](https://openrouter.ai/docs/api/reference/limits)
- [Preguntas frecuentes](https://openrouter.ai/docs/faq)
- [Precios](https://openrouter.ai/pricing)
- [Modelos gratuitos](https://openrouter.ai/collections/free-models)
- [Control de gasto](https://openrouter.ai/blog/tutorials/team-spend-controls-setup/)
- [Guardrails](https://openrouter.ai/docs/guides/features/guardrails)
