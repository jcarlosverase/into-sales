import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import intoPreset from "@into/designsystem/tailwind";

/**
 * Spec 1021: el tema sale del sistema de diseño into (vendor/): colores
 * semánticos (background, primary, muted…), escala `brand-*` (el acento
 * white-label), estados, radios, sombras y las tres fuentes de la marca, con
 * sus variables y estilos base. Aquí solo va lo propio del CRM: el chat.
 *
 * Las dos reglas del tema oscuro siguen en pie (ver el preset): nada de
 * colores literales en la UI y nada de modificador de opacidad sobre un color
 * `var(--x)`. Excepción deliberada de la primera: la paleta de identidad
 * (avatares, palomita azul de WhatsApp), tonos medios legibles en ambos temas.
 */
const config: Config = {
  presets: [intoPreset],
  // La segunda ruta deja que Tailwind vea las clases de los componentes del
  // sistema de diseño: sin ella salen sin estilo.
  content: ["./src/**/*.{ts,tsx}", "./node_modules/@into/designsystem/dist/**/*.js"],
  theme: {
    extend: {
      colors: {
        // El hilo del chat y sus burbujas (variables en globals.css).
        chat: "var(--chat-bg)",
        "bubble-in": "var(--bubble-in)",
        "bubble-in-border": "var(--bubble-in-border)",
        "bubble-out": "var(--bubble-out)",
        "bubble-out-border": "var(--bubble-out-border)",
        "bubble-out-text": "var(--bubble-out-text)",
      },
    },
  },
  plugins: [animate],
};

export default config;
