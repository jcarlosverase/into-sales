# 1018 — La sesión se cierra tras 12 horas sin uso

**Created**: 2026-10-31

**Status**: Especificada antes de escribir código. Implementada; pruebas
unitarias, typecheck y lint en verde.

**Input**: Juan Carlos el 2026-10-31: «creo que en into-sales la sesión del
usuario nunca se cierra, sin embargo en into-central sí». Eligió la opción de
cierre por inactividad («hazlo así»).

**Carril**: ligero. Configuración de la sesión y un componente del cliente; sin
migración.

## Problema

into-sales usaba los valores por defecto de Better Auth: la sesión dura 7 días
y se renueva sola con el uso, así que quien entra al menos una vez por semana
no la pierde nunca. En un teléfono que se presta o se pierde, o en una
computadora compartida, el CRM queda abierto indefinidamente. into-central, en
cambio, la cierra a las 12 horas.

## Comportamiento observable y criterios de aceptación

- **AC1** — Si nadie usa el CRM durante 12 horas (sin clics, teclas ni toques
  en la página), la sesión vence: la siguiente navegación o llamada lleva al
  inicio de sesión.
- **AC2** — Mientras alguien trabaja, la sesión no se corta: con actividad
  real, el navegador la renueva como mucho cada 10 minutos, y cada renovación
  vuelve a contar 12 horas, en la base y en la cookie.
- **AC3** — Una pestaña abierta sin que nadie la toque NO mantiene viva la
  sesión: los avisos en tiempo real, los sondeos de la Bandeja o volver a
  enfocar la ventana no cuentan como actividad.
- **AC4** — Si al renovar el servidor dice que la sesión ya no existe (venció o
  se cerró), la pantalla lleva al inicio de sesión.
- **AC5** — Las sesiones abiertas antes de este cambio pasan a la regla nueva
  en su próxima renovación; nadie tiene que volver a entrar al desplegar.

## Qué se decidió NO hacer y por qué

- **Duración fija como into-central**: cortaría a un vendedor en mitad de una
  conversación. Queda por inactividad (decisión de Juan Carlos).
- **Cerrar sesión en todos los dispositivos** y que el propietario cierre las
  sesiones de un vendedor: ofrecidos, no pedidos; van en su propia spec si se
  piden.

## Dónde vive

`src/lib/auth/session-policy.ts` (las duraciones y la regla de renovación) ·
`src/lib/auth/index.ts` (`session` de Better Auth) ·
`src/components/session-keep-alive.tsx` (montado en `src/components/app-shell.tsx`)
· prueba en `tests/unit/session-policy.test.ts`.
