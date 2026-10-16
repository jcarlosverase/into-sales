import type { IndustrySample } from "./types";

/** 023 — Lúa Moda: vestidos para mujer, venta en línea con envíos. */
export const fashion: IndustrySample = {
  key: "fashion",
  businessName: "Lúa Moda",
  currency: "PEN",
  contacts: [
    {
      name: "Valeria Castro",
      stage: "Interesado",
      source: "anuncio",
      priority: "alta",
      amountCents: 18900,
      thread: [
        { dir: "in", text: "Hola!! El vestido verde del anuncio, ¿lo tienen en talla M?", hoursAgo: 3 },
        { dir: "out", text: "¡Hola Valeria! Sí, el vestido Olivia verde está en talla M. Cuesta S/ 189 y es de tela crepé con forro.", hoursAgo: 3, ai: true },
        { dir: "in", text: "¿Cuánto es el envío a Miraflores?", hoursAgo: 2 },
        { dir: "out", text: "El envío en Lima es S/ 10 y llega en 24 a 48 horas. Si compras dos prendas, el envío es gratis.", hoursAgo: 2, ai: true },
        { dir: "in", text: "Ya, lo quiero. ¿Les yapeo?", hoursAgo: 1 },
      ],
    },
    {
      name: "Daniela Ruiz",
      stage: "En conversación",
      source: "anuncio",
      thread: [
        { dir: "in", text: "Hola, ¿hacen envíos a Arequipa?", hoursAgo: 10 },
        { dir: "out", text: "¡Hola Daniela! Sí, enviamos a todo el Perú por Olva o Shalom. A Arequipa cuesta S/ 15 y llega en 2 a 4 días hábiles.", hoursAgo: 10, ai: true },
        { dir: "in", text: "¿Y qué tallas manejan?", hoursAgo: 9 },
        { dir: "out", text: "De la S a la XL. Si me dices tu talla habitual de blusa, te ayudo a elegir.", hoursAgo: 9, ai: true },
      ],
    },
    {
      name: "Fiorella Mendoza",
      stage: "Nuevo",
      source: "organico",
      thread: [
        { dir: "in", text: "precio del vestido negro de la foto?", hoursAgo: 1 },
        { dir: "out", text: "¡Hola Fiorella! ¿Me mandas captura de la foto? Tenemos varios modelos en negro y quiero darte el precio exacto.", hoursAgo: 1, ai: true },
      ],
    },
    {
      name: "Karla Espinoza",
      stage: "Cliente",
      source: "referido",
      amountCents: 34800,
      notes: "Clienta frecuente. Compra para eventos; talla S.",
      thread: [
        { dir: "in", text: "Ya me llegaron los dos vestidos, me quedaron perfectos 😍", hoursAgo: 40 },
        { dir: "out", text: "¡Qué alegría, Karla! Gracias por tu compra. Si nos mandas una foto con el vestido, la compartimos con tu permiso 💛", hoursAgo: 39 },
      ],
    },
    {
      name: "Lucía Herrera",
      stage: "Perdido",
      source: "anuncio",
      notes: "Necesitaba el vestido para el sábado y no llegaba a tiempo a Trujillo.",
      thread: [
        { dir: "in", text: "Lo necesito para este sábado en Trujillo, ¿llega?", hoursAgo: 80 },
        { dir: "out", text: "Hola Lucía, a Trujillo demora de 2 a 4 días hábiles, así que no podemos asegurarte que llegue el sábado. Lo siento mucho.", hoursAgo: 80, ai: true },
        { dir: "in", text: "Ok, gracias", hoursAgo: 79 },
      ],
    },
    {
      name: "Andrea Salinas",
      stage: "Interesado",
      source: "anuncio",
      priority: "media",
      amountCents: 21900,
      thread: [
        { dir: "in", text: "¿Tienen cambio si no me queda?", hoursAgo: 18 },
        { dir: "out", text: "¡Hola Andrea! Sí: tienes 7 días para cambiar de talla o modelo, con la prenda sin usar y con etiqueta. El envío del cambio en Lima es gratis.", hoursAgo: 18, ai: true },
        { dir: "in", text: "Genial, déjame pensarlo y te aviso", hoursAgo: 17 },
      ],
    },
  ],
  templates: [
    {
      name: "moda_pedido_enviado",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, tu pedido {{2}} ya salió. Puedes seguirlo con el código {{3}}. ¡Gracias por comprar en Lúa Moda!",
    },
    {
      name: "moda_carrito_pendiente",
      language: "es_PE",
      category: "MARKETING",
      body: "Hola {{1}}, el vestido {{2}} que te gustó sigue disponible en tu talla, pero quedan pocas unidades. ¿Te lo separo?",
    },
    {
      name: "moda_nueva_coleccion",
      language: "es_PE",
      category: "MARKETING",
      body: "Hola {{1}}, ya llegó la nueva colección {{2}}. Escríbenos y te mandamos el catálogo con tallas y precios.",
    },
  ],
  knowledge: [
    {
      kind: "block",
      content:
        "Lúa Moda es una tienda en línea de vestidos para mujer en Lima. Vendemos por Instagram y WhatsApp, con envíos a todo el Perú. Tallas de la S a la XL; vestidos de S/ 129 a S/ 249.",
    },
    { kind: "qa", question: "¿Cuánto cuesta el envío?", answer: "En Lima: S/ 10, llega en 24 a 48 horas. Provincias: S/ 15 por Olva o Shalom, de 2 a 4 días hábiles. Envío gratis comprando dos prendas o más." },
    { kind: "qa", question: "¿Cómo se paga?", answer: "Yape, Plin o transferencia a BCP o Interbank. En Lima también contra entrega en efectivo." },
    { kind: "qa", question: "¿Qué tallas tienen?", answer: "De la S a la XL. La guía de tallas: S (busto 84-88 cm), M (89-93 cm), L (94-98 cm), XL (99-104 cm)." },
    { kind: "qa", question: "¿Hacen cambios?", answer: "Sí, dentro de los 7 días de recibido, con la prenda sin usar y con etiqueta. El envío del cambio en Lima es gratis. No hacemos devoluciones de dinero." },
    { kind: "qa", question: "¿Tienen tienda física?", answer: "No, somos solo tienda en línea. Puedes recoger tu pedido coordinando con nosotras en Lince." },
    { kind: "qa", question: "¿Cuánto demora en llegar?", answer: "Lima: 24 a 48 horas desde que confirmamos el pago. Provincias: 2 a 4 días hábiles." },
    { kind: "qa", question: "¿Hacen vestidos a medida?", answer: "No, solo vendemos las tallas de nuestra colección." },
  ],
  agent: {
    name: "Lúa",
    tone: "Amigable y entusiasta, como una vendedora de boutique que asesora con buen gusto. Tutea a la clienta y usa algún emoji con moderación.",
    instructions:
      "Ayuda a elegir modelo y talla, da precios y costos de envío en soles solo si están en el conocimiento y cierra el pedido pidiendo talla, dirección y medio de pago. Nunca confirmes stock de un modelo que no reconoces: pide una captura.",
    escalationRules:
      "Pasa la conversación a una persona si hay un reclamo por un pedido, si piden un cambio de un pedido ya entregado, si mandan el comprobante de pago o si lo piden.",
    greeting: "¡Hola! Soy Lúa 💛 ¿Qué vestido te gustó?",
  },
};
