import type { IndustrySample } from "./types";

/** 023 — Inmobiliaria Altamira: departamentos en Lima. */
export const realEstate: IndustrySample = {
  key: "realestate",
  businessName: "Inmobiliaria Altamira",
  currency: "PEN",
  contacts: [
    {
      name: "Patricia Salazar",
      stage: "Interesado",
      source: "anuncio",
      priority: "alta",
      amountCents: 42000000,
      notes: "Busca 3 dormitorios en Surco para mudarse en marzo. Precalificada en su banco.",
      thread: [
        { dir: "in", text: "Hola, me interesa el proyecto de Surco del anuncio. ¿Qué precios tienen?", hoursAgo: 8 },
        { dir: "out", text: "¡Hola Patricia! En Residencial Los Álamos (Surco) tenemos departamentos de 2 dormitorios desde S/ 365,000 y de 3 dormitorios desde S/ 420,000. La entrega es en marzo.", hoursAgo: 8, ai: true },
        { dir: "in", text: "Me interesa el de 3. ¿Cuánto es la inicial?", hoursAgo: 7 },
        { dir: "out", text: "La inicial mínima es el 10 % (S/ 42,000) y puedes separarlo con S/ 3,000. Trabajamos con BCP, BBVA e Interbank para el crédito hipotecario.", hoursAgo: 7, ai: true },
        { dir: "in", text: "¿Puedo visitar el piloto este fin de semana?", hoursAgo: 6 },
      ],
    },
    {
      name: "Ricardo Gómez",
      stage: "En conversación",
      source: "anuncio",
      thread: [
        { dir: "in", text: "¿Aplica para el bono Mivivienda?", hoursAgo: 26 },
        { dir: "out", text: "¡Hola Ricardo! Sí: el proyecto de San Miguel califica para el Nuevo Crédito Mivivienda. Los departamentos van desde S/ 285,000. ¿Es tu primera vivienda?", hoursAgo: 26, ai: true },
        { dir: "in", text: "Sí, es la primera. Somos dos con mi esposa", hoursAgo: 25 },
      ],
    },
    {
      name: "Elena Vargas",
      stage: "Nuevo",
      source: "organico",
      thread: [
        { dir: "in", text: "Buenas tardes, ¿tienen departamentos en alquiler?", hoursAgo: 2 },
        { dir: "out", text: "¡Hola Elena! Por ahora solo vendemos departamentos en nuestros proyectos de Surco y San Miguel. Si te interesa comprar, te cuento las opciones.", hoursAgo: 2, ai: true },
      ],
    },
    {
      name: "Martín Chávez",
      stage: "Cliente",
      source: "referido",
      amountCents: 36500000,
      notes: "Firmó la minuta del 2 dormitorios, piso 7, en Los Álamos.",
      thread: [
        { dir: "in", text: "Ya firmamos la minuta en el banco 🎉", hoursAgo: 60 },
        { dir: "out", text: "¡Felicitaciones, Martín! Ya registramos la venta del departamento 702. Te avisaremos cada avance de obra hasta la entrega en marzo.", hoursAgo: 59 },
      ],
    },
    {
      name: "Sofía Medina",
      stage: "Perdido",
      source: "anuncio",
      notes: "Su banco no aprobó el monto del crédito.",
      thread: [
        { dir: "in", text: "Me aprobaron menos de lo que necesitaba, no me alcanza", hoursAgo: 90 },
        { dir: "out", text: "Entiendo, Sofía. Si más adelante tu situación cambia, aquí estaremos. También podemos avisarte cuando lancemos proyectos con precios más bajos.", hoursAgo: 89 },
      ],
    },
    {
      name: "Diego Ramos",
      stage: "Interesado",
      source: "organico",
      priority: "media",
      amountCents: 28500000,
      thread: [
        { dir: "in", text: "¿El departamento de San Miguel tiene estacionamiento?", hoursAgo: 15 },
        { dir: "out", text: "¡Hola Diego! Los de 3 dormitorios incluyen estacionamiento. Para los de 2 dormitorios se compra aparte, en S/ 25,000.", hoursAgo: 15, ai: true },
        { dir: "in", text: "Ok, ¿me envían los planos?", hoursAgo: 14 },
      ],
    },
  ],
  templates: [
    {
      name: "inmobiliaria_confirmacion_visita",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, tu visita al piloto de {{2}} está confirmada para el {{3}}. Te esperamos en la sala de ventas. Si necesitas cambiar la hora, respóndenos aquí.",
    },
    {
      name: "inmobiliaria_seguimiento_cotizacion",
      language: "es_PE",
      category: "MARKETING",
      body: "Hola {{1}}, ¿pudiste revisar la cotización del departamento en {{2}}? Quedan pocas unidades con el precio de preventa. ¿Agendamos una visita?",
    },
    {
      name: "inmobiliaria_avance_obra",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, te compartimos el avance de obra de {{2}}: {{3}}. Cualquier consulta, escríbenos por aquí.",
    },
  ],
  knowledge: [
    {
      kind: "block",
      content:
        "Inmobiliaria Altamira vende departamentos de estreno en Lima. Proyectos actuales: Residencial Los Álamos en Surco (2 y 3 dormitorios, entrega en marzo) y Parque San Miguel en San Miguel (2 y 3 dormitorios, califica para Mivivienda).",
    },
    { kind: "qa", question: "¿Cuáles son los precios?", answer: "Los Álamos (Surco): 2 dormitorios desde S/ 365,000 y 3 dormitorios desde S/ 420,000. Parque San Miguel: desde S/ 285,000." },
    { kind: "qa", question: "¿Cuánto es la inicial?", answer: "La inicial mínima es el 10 % del precio. Se separa el departamento con S/ 3,000." },
    { kind: "qa", question: "¿Con qué bancos trabajan?", answer: "BCP, BBVA, Interbank y Scotiabank. Te ayudamos con la precalificación sin costo." },
    { kind: "qa", question: "¿Aplica para Mivivienda?", answer: "Sí, Parque San Miguel califica para el Nuevo Crédito Mivivienda y el Bono del Buen Pagador, si es tu primera vivienda." },
    { kind: "qa", question: "¿Dónde está la sala de ventas?", answer: "En cada proyecto hay un departamento piloto. Atención de lunes a domingo de 10:00 a 19:00, con cita previa." },
    { kind: "qa", question: "¿Incluye estacionamiento?", answer: "Los de 3 dormitorios incluyen un estacionamiento. Para los de 2 dormitorios se compra aparte, desde S/ 25,000." },
    { kind: "qa", question: "¿Tienen alquileres?", answer: "No, solo vendemos departamentos de nuestros proyectos." },
  ],
  agent: {
    name: "Alta",
    tone: "Profesional y cercano, como una asesora inmobiliaria con paciencia para explicar el crédito. Trata de usted si el cliente lo hace.",
    instructions:
      "Identifica qué busca el cliente (distrito, dormitorios, presupuesto, si es primera vivienda) y recomienda el proyecto que encaja. Da precios en soles solo si están en el conocimiento. El objetivo es agendar una visita al piloto.",
    escalationRules:
      "Pasa la conversación a una persona si piden negociar el precio, si el cliente ya separó o compró, si hay un reclamo o si lo piden.",
    greeting: "¡Hola! Soy Alta, de Inmobiliaria Altamira 🏢 ¿En qué distrito estás buscando tu departamento?",
  },
};
