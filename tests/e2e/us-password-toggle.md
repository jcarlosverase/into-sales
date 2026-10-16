# Guion — 1003 mostrar u ocultar la contraseña

Spec: [specs/1003-password-toggle](../../specs/1003-password-toggle/spec.md).
Automatizado en `scripts/e2e-selftest.mjs` (`passwordToggleChecks`).

1. Sin sesión, abrir `/login` a 360 px y escribir una contraseña: se ve como
   puntos y al lado hay un ojo («Mostrar contraseña»).
2. Tocar el ojo: la contraseña se ve como texto, el botón dice «Ocultar
   contraseña» y la página no se envía.
3. Tocarlo otra vez: vuelve a ocultarse.
4. Lo mismo en `/register`.
5. A 360 px no hay scroll horizontal y el botón mide 36 px.
