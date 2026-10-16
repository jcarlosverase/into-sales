# Propuesta de enmienda constitucional — 1.4.0 → 1.5.0

**Fecha**: 2026-10-14 · **Pedida por**: Juan Carlos (responsable del
proyecto) · **Spec que la necesita**: [028](spec.md)

## Qué choca hoy

La spec 028 conecta el CRM con el servicio central de into: un latido con el
estado del diagnóstico y, de vuelta, el plan que el cliente contrató. Dos
frases de la constitución 1.4.0 lo impiden tal como están escritas:

1. **Principio VIII**: «Lo que solo sirva a una plataforma centralizada
   (billing, planes, multi-instancia) queda FUERA.» El latido y el plan sirven
   justamente a una plataforma centralizada: la de into, que instala y mantiene
   los CRM de sus clientes.
2. **Principio II, conector opcional, condición 4**: «cada instancia habla con
   SU cuenta del proveedor; jamás credenciales de una plataforma central». La
   llave de licencia la emite el central de into.

## Qué se propone

**Principio VIII** — en lugar de excluir todo lo de una plataforma
centralizada, distinguir dos cosas:

- Sigue **FUERA** que el CRM se vuelva una plataforma: cobrar (billing),
  administrar varias instancias desde una o vender planes dentro del CRM.
- Entra un **conector opcional al servicio central de quien instala y
  mantiene el CRM** (la agencia, como into), bajo las condiciones del
  Principio II: puede recibir el estado del diagnóstico (sin detalle ni datos
  de conversaciones o contactos) y devolver información de la cuenta de ese
  negocio, como su plan, para mostrarla. No puede bloquear ni limitar la
  operación core sin una enmienda nueva.

**Principio II, condición 4** — agregar la excepción acotada:

> La credencial de un conector al servicio central de quien mantiene la
> instancia (Principio VIII) es la del propio negocio con ese proveedor: se
> trata como cualquier otra credencial del negocio (cifrada en reposo, solo
> sus últimos 4 hacia fuera) y no le da al central acceso a la instancia.

## Por qué MINOR

Es una expansión material de dos principios. No cambia nada para una
instancia por defecto: sin la bandera `INTO_CENTRAL_URL`, el CRM sigue siendo
«un VPS, un dominio, credenciales de Meta y un token de OpenRouter. Nada
más».

## Estado

Pedida por Juan Carlos el 2026-10-14 junto con la spec 028. El texto aplicado
en `.specify/memory/constitution.md` espera su revisión antes del commit.
