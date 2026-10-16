import type { IndustrySample } from "./types";

/** 023 — Academia Horizonte: preuniversitaria e inglés en Lima. */
export const academy: IndustrySample = {
  key: "academy",
  businessName: "Academia Horizonte",
  currency: "PEN",
  contacts: [
    {
      name: "Rosa Quispe",
      stage: "Interesado",
      source: "anuncio",
      priority: "alta",
      amountCents: 145000,
      notes: "Mamá de Diego, 5.º de secundaria. Quiere el ciclo de verano para San Marcos.",
      thread: [
        { dir: "in", text: "Hola, vi su anuncio del ciclo de verano. ¿Para San Marcos tienen?", hoursAgo: 6 },
        { dir: "out", text: "¡Hola Rosa! Sí: el Ciclo Verano San Marcos empieza el 5 de enero, de lunes a viernes de 8:00 a 13:00. La inversión es S/ 1,450 por los dos meses, con materiales incluidos.", hoursAgo: 6, ai: true },
        { dir: "in", text: "¿Hay descuento si pago todo junto?", hoursAgo: 5 },
        { dir: "out", text: "Sí: pagando la matrícula antes del 15 de diciembre te queda en S/ 1,300. También puedes pagarlo en dos cuotas de S/ 725.", hoursAgo: 5, ai: true },
        { dir: "in", text: "Ya, mi hijo quiere ir a ver el local primero. ¿Se puede el sábado?", hoursAgo: 4 },
      ],
    },
    {
      name: "Luis Fernández",
      stage: "En conversación",
      source: "organico",
      thread: [
        { dir: "in", text: "Buenas noches, ¿cuánto cuesta el curso de inglés para adultos?", hoursAgo: 20 },
        { dir: "out", text: "¡Hola Luis! El inglés para adultos es de S/ 280 al mes, tres veces por semana en horario nocturno (7:00 a 9:00 p. m.). Antes de empezar te tomamos un examen de nivel gratuito.", hoursAgo: 20, ai: true },
        { dir: "in", text: "¿Es presencial o virtual?", hoursAgo: 19 },
        { dir: "out", text: "Tenemos las dos modalidades. La virtual es por Zoom con las mismas profesoras y el mismo precio.", hoursAgo: 19, ai: true },
      ],
    },
    {
      name: "Camila Rojas",
      stage: "Nuevo",
      source: "anuncio",
      thread: [
        { dir: "in", text: "hola info del preu porfa", hoursAgo: 1 },
        { dir: "out", text: "¡Hola Camila! Con gusto. ¿Para qué universidad te estás preparando? Tenemos ciclos para San Marcos, UNI y Villarreal.", hoursAgo: 1, ai: true },
      ],
    },
    {
      name: "Jorge Huamán",
      stage: "Cliente",
      source: "referido",
      amountCents: 130000,
      notes: "Matriculó a su hija Valeria. Pagó con descuento por pago adelantado.",
      thread: [
        { dir: "in", text: "Ya hice la transferencia de la matrícula de Valeria", hoursAgo: 48 },
        { dir: "out", text: "¡Gracias, Jorge! Recibimos el pago de S/ 1,300. Valeria ya está matriculada en el Ciclo Verano San Marcos. El 5 de enero la esperamos a las 7:45.", hoursAgo: 47 },
        { dir: "in", text: "Perfecto, gracias", hoursAgo: 47 },
      ],
    },
    {
      name: "Milagros Torres",
      stage: "Perdido",
      source: "anuncio",
      notes: "Eligió una academia más cerca de su casa en Ate.",
      thread: [
        { dir: "in", text: "¿Tienen sede en Ate?", hoursAgo: 72 },
        { dir: "out", text: "Hola Milagros. Por ahora solo tenemos la sede de Jesús María, a dos cuadras de la avenida Brasil. También está la modalidad virtual.", hoursAgo: 72, ai: true },
        { dir: "in", text: "Ah, queda lejos. Gracias igual", hoursAgo: 71 },
      ],
    },
    {
      name: "Andrés Paredes",
      stage: "Interesado",
      source: "organico",
      priority: "media",
      amountCents: 145000,
      thread: [
        { dir: "in", text: "Hola, quiero postular a la UNI. ¿Cuántas horas de matemática tienen?", hoursAgo: 30 },
        { dir: "out", text: "¡Hola Andrés! El Ciclo UNI tiene 18 horas semanales de matemática (álgebra, aritmética, geometría y trigonometría) y simulacros cada sábado.", hoursAgo: 30, ai: true },
        { dir: "in", text: "Mándame el horario completo porfa", hoursAgo: 29 },
      ],
    },
  ],
  templates: [
    {
      name: "academia_recordatorio_clase",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, te recordamos que tu clase de {{2}} empieza mañana a las {{3}} en Academia Horizonte. Si no puedes asistir, respóndenos este mensaje.",
    },
    {
      name: "academia_seguimiento_matricula",
      language: "es_PE",
      category: "MARKETING",
      body: "Hola {{1}}, ¿pudiste revisar la información del {{2}}? Las vacantes con descuento por pago adelantado son hasta el {{3}}. ¿Te ayudo a reservar la tuya?",
    },
    {
      name: "academia_confirmacion_pago",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, recibimos tu pago de {{2}}. Tu matrícula en el {{3}} está confirmada. ¡Te esperamos!",
    },
  ],
  knowledge: [
    {
      kind: "block",
      content:
        "Academia Horizonte es una academia preuniversitaria y de inglés en Jesús María, Lima, con 12 años de experiencia. Preparamos para San Marcos, UNI y Villarreal, y dictamos inglés para escolares y adultos. Clases presenciales y virtuales.",
    },
    { kind: "qa", question: "¿Dónde están ubicados?", answer: "Jr. Los Cedros 450, Jesús María (dirección de ejemplo)." },
    { kind: "qa", question: "¿Qué ciclos tienen y cuánto cuestan?", answer: "Ciclo Verano (enero y febrero): S/ 1,450. Ciclo Semestral (marzo a julio): S/ 2,600. Inglés escolar y adultos: S/ 280 al mes." },
    { kind: "qa", question: "¿Hay descuentos?", answer: "Pagando el ciclo completo antes del 15 de diciembre: S/ 150 de descuento. Hermanos: 10 % de descuento al segundo." },
    { kind: "qa", question: "¿Cuáles son los horarios?", answer: "Preuniversitario: lunes a viernes de 8:00 a 13:00 o de 15:00 a 20:00. Inglés adultos: lunes, miércoles y viernes de 19:00 a 21:00." },
    { kind: "qa", question: "¿Cómo se paga?", answer: "Transferencia a BCP o Interbank, Yape, Plin o tarjeta en la sede. Se puede pagar en dos cuotas." },
    { kind: "qa", question: "¿Tienen clases virtuales?", answer: "Sí, todos los ciclos tienen modalidad virtual por Zoom, con las mismas profesoras, materiales digitales y las clases grabadas." },
    { kind: "qa", question: "¿Se puede visitar la academia?", answer: "Sí, de lunes a sábado de 9:00 a 18:00. Recomendamos agendar la visita por WhatsApp." },
  ],
  agent: {
    name: "Hori",
    tone: "Cálido y claro, como una asesora de matrícula que conoce a las familias. Trata de tú a los alumnos y de usted a los padres si ellos lo hacen.",
    instructions:
      "Ayuda a elegir el ciclo correcto según la universidad o el nivel de inglés. Da precios en soles solo si están en el conocimiento. Invita a agendar una visita o el examen de nivel gratuito. Recuerda la fecha límite del descuento cuando corresponda.",
    escalationRules:
      "Pasa la conversación a una persona si piden una beca o un caso especial de pago, si hay un reclamo, si es un tema de un alumno ya matriculado o si lo piden.",
    greeting: "¡Hola! Soy Hori, de Academia Horizonte 📚 ¿Para qué te estás preparando?",
  },
};
