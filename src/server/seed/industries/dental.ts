import type { WeeklyHours } from "@/server/agenda/settings";
import type { IndustrySample } from "./types";

/** Hours helper: the same interval on several days. */
function days(list: (keyof WeeklyHours)[], start: string, end: string): WeeklyHours {
  return Object.fromEntries(list.map((d) => [d, [{ start, end }]]));
}

const WEEKDAYS: (keyof WeeklyHours)[] = ["mon", "tue", "wed", "thu", "fri"];

/** Monday to Friday 8:00–18:00 and Saturday 8:00–14:00, as the knowledge says. */
const BUSINESS_HOURS: WeeklyHours = {
  ...days(WEEKDAYS, "08:00", "18:00"),
  sat: [{ start: "08:00", end: "14:00" }],
};

/**
 * 023 — Clínica Dental Calma: endodoncia y odontología general en Lima, con
 * atención para pacientes con miedo al dentista. Precios de referencia de
 * clínicas privadas de Lima (abril de 2026), redondeados; son de ejemplo.
 */
export const dental: IndustrySample = {
  key: "dental",
  businessName: "Clínica Dental Calma",
  currency: "PEN",
  contacts: [
    {
      name: "Patricia Salazar",
      stage: "Interesado",
      source: "anuncio",
      priority: "alta",
      amountCents: 95000,
      notes: "Dolor fuerte en una muela de abajo desde hace dos días. Prefiere venir hoy o mañana temprano.",
      thread: [
        { dir: "in", text: "Hola, tengo un dolor horrible en una muela, no he podido dormir. ¿Me pueden atender hoy?", hoursAgo: 5 },
        { dir: "out", text: "¡Hola Patricia! Siento mucho que estés pasando por eso. Hoy tenemos un espacio a las 4:00 p. m. para una evaluación de urgencia con radiografía (S/ 80). ¿Te lo reservo?", hoursAgo: 5, ai: true },
        { dir: "in", text: "Sí porfa. ¿Y si es endodoncia cuánto sale?", hoursAgo: 4 },
        { dir: "out", text: "Te lo reservé para hoy a las 4:00 p. m. Si el doctor confirma que es endodoncia, en una molar es desde S/ 950 y la evaluación de hoy se descuenta de ese monto. Si en algún momento notas hinchazón o fiebre, escríbenos de inmediato.", hoursAgo: 4, ai: true },
        { dir: "in", text: "Ok gracias, ahí estaré", hoursAgo: 4 },
      ],
    },
    {
      name: "Ricardo Medina",
      stage: "En conversación",
      source: "organico",
      thread: [
        { dir: "in", text: "Buenas, la verdad le tengo pánico al dentista. ¿Es cierto que trabajan con hipnosis?", hoursAgo: 22 },
        { dir: "out", text: "¡Hola Ricardo! Es más común de lo que crees, y aquí lo tomamos con calma. Sí: para pacientes con miedo o ansiedad usamos técnicas de relajación e hipnosis clínica antes y durante el tratamiento. Tú siempre tienes el control y podemos parar cuando lo pidas.", hoursAgo: 22, ai: true },
        { dir: "in", text: "¿Y eso cuesta más?", hoursAgo: 21 },
        { dir: "out", text: "La primera sesión de adaptación es de S/ 120 e incluye la evaluación. Ahí conoces el consultorio sin hacer ningún procedimiento. ¿Te gustaría agendarla?", hoursAgo: 21, ai: true },
      ],
    },
    {
      name: "Sofía Valdivia",
      stage: "Nuevo",
      source: "anuncio",
      thread: [
        { dir: "in", text: "hola cuanto cuesta una endodoncia", hoursAgo: 1 },
        { dir: "out", text: "¡Hola Sofía! Depende del diente: en un diente de adelante es desde S/ 420, en un premolar desde S/ 650 y en una molar desde S/ 950, con la evaluación y la radiografía incluidas. ¿Sabes cuál es el diente o quieres que lo veamos en una evaluación?", hoursAgo: 1, ai: true },
      ],
    },
    {
      name: "Manuel Chávez",
      stage: "Cliente",
      source: "referido",
      amountCents: 65000,
      notes: "Endodoncia de premolar en dos sesiones. Le toca la corona con su dentista de cabecera.",
      thread: [
        { dir: "in", text: "Doctor, ya no me duele nada, muchas gracias", hoursAgo: 50 },
        { dir: "out", text: "¡Qué buena noticia, Manuel! Recuerda no masticar fuerte con ese lado hasta que te pongan la corona. Te mandamos el informe y la radiografía final para tu dentista.", hoursAgo: 49 },
        { dir: "in", text: "Perfecto, le paso el dato a mi hermana también", hoursAgo: 48 },
      ],
    },
    {
      name: "Gabriela Ponce",
      stage: "Perdido",
      source: "anuncio",
      notes: "Buscaba que su seguro EPS cubriera el tratamiento.",
      thread: [
        { dir: "in", text: "¿Trabajan con Pacífico EPS?", hoursAgo: 80 },
        { dir: "out", text: "Hola Gabriela. Por ahora no tenemos convenio con aseguradoras: te damos la boleta o factura para que pidas el reembolso. También puedes pagar en dos partes.", hoursAgo: 80, ai: true },
        { dir: "in", text: "Ah ya, voy a ver en mi clínica del seguro. Gracias", hoursAgo: 79 },
      ],
    },
    {
      name: "Héctor Ramos",
      stage: "Interesado",
      source: "organico",
      priority: "media",
      amountCents: 75000,
      notes: "Le hicieron una endodoncia hace años en otro lugar y volvió a doler. Posible retratamiento.",
      thread: [
        { dir: "in", text: "Hola, me hicieron una endodoncia hace 5 años y otra vez me molesta. ¿Se puede hacer de nuevo?", hoursAgo: 30 },
        { dir: "out", text: "¡Hola Héctor! Sí, se llama retratamiento de endodoncia y es justamente una de nuestras especialidades. Primero hay que ver la radiografía para saber qué pasó. El retratamiento es desde S/ 750 según el diente.", hoursAgo: 30, ai: true },
        { dir: "in", text: "¿Tienen sábado?", hoursAgo: 29 },
      ],
    },
  ],
  templates: [
    {
      name: "dental_recordatorio_cita",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, te recordamos tu cita en Clínica Dental Calma mañana a las {{2}}. Si no puedes venir, respóndenos este mensaje y la reprogramamos.",
    },
    {
      name: "dental_control_post_tratamiento",
      language: "es_PE",
      category: "UTILITY",
      body: "Hola {{1}}, ¿cómo sigues después de tu {{2}}? Si tienes dolor, hinchazón o cualquier duda, escríbenos por aquí.",
    },
    {
      name: "dental_seguimiento_evaluacion",
      language: "es_PE",
      category: "MARKETING",
      body: "Hola {{1}}, ¿pudiste revisar el presupuesto de tu {{2}}? Esta semana todavía tenemos horarios en la mañana y en la tarde. ¿Te ayudo a separar el tuyo?",
    },
  ],
  knowledge: [
    {
      kind: "block",
      content:
        "Clínica Dental Calma es un consultorio de endodoncia y odontología general en Pueblo Libre, Lima. El especialista es endodoncista con más de 15 años de experiencia. Atendemos dolor dental, infecciones, endodoncias y retratamientos con sistema rotacional, y tenemos atención especial para pacientes con miedo o ansiedad al dentista (técnicas de relajación e hipnosis clínica). Lema: «El fin del dolor, el inicio de tu tranquilidad».",
    },
    { kind: "qa", question: "¿Dónde están ubicados?", answer: "Av. Sucre 820, consultorio 305, Pueblo Libre (dirección de ejemplo). Hay estacionamiento pagado en el edificio." },
    { kind: "qa", question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8:00 a. m. a 6:00 p. m. y sábados de 8:00 a. m. a 2:00 p. m. Domingos y feriados no atendemos; para urgencias fuera de horario, escribe y te respondemos a primera hora." },
    { kind: "qa", question: "¿Quiénes atienden? ¿Con qué doctor me toca?", answer: "Somos un equipo de 10 profesionales. Endodoncia: Dra. Lucía Paredes, Dr. Martín Quispe y Dra. Carla Benavides. Odontología general: Dr. Andrés Villanueva y Dra. Rosa Huamán. Odontopediatría (niños): Dra. Valeria Rojas. Ortodoncia (brackets y alineadores): Dr. Jorge Castañeda. Periodoncia (encías): Dra. Milagros Torres. Cirugía bucal (muelas del juicio, implantes): Dr. Renato Cárdenas. Rehabilitación oral (coronas y prótesis): Dra. Fiorella Lazo. Puedes pedir a alguien en particular o te damos el primer horario libre." },
    { kind: "qa", question: "¿Cuánto cuesta la endodoncia?", answer: "Precios de referencia con evaluación y radiografía incluidas: diente anterior desde S/ 420, premolar desde S/ 650, molar desde S/ 950. Retratamiento de endodoncia desde S/ 750. El precio final se confirma en la evaluación." },
    { kind: "qa", question: "¿Cuánto cuesta la evaluación?", answer: "Evaluación con radiografía: S/ 80. Si haces el tratamiento con nosotros, se descuenta del total. Sesión de adaptación para pacientes con miedo: S/ 120, con la evaluación incluida." },
    { kind: "qa", question: "¿Qué otros tratamientos hacen y cuánto cuestan?", answer: "Limpieza dental S/ 120. Curación con resina desde S/ 150. Extracción simple desde S/ 150. Corona de zirconio desde S/ 1,200. Blanqueamiento S/ 550." },
    { kind: "qa", question: "¿Qué tengo? ¿Es caries, el nervio o una infección?", answer: "Por chat ni por foto se puede saber: el mismo síntoma puede tener causas distintas. Lo confirma el doctor en la evaluación con radiografía (S/ 80), que se descuenta si haces el tratamiento con nosotros." },
    { kind: "qa", question: "¿Duele la endodoncia?", answer: "Con anestesia local el tratamiento no debería doler; lo que duele es la infección que estamos quitando. Los primeros días puede haber molestia leve, que se controla con la indicación del doctor." },
    { kind: "qa", question: "¿Cuántas sesiones son?", answer: "La mayoría se termina en una o dos sesiones de 60 a 90 minutos. Un retratamiento o una infección grande puede necesitar una sesión más." },
    { kind: "qa", question: "¿Qué es la hipnosis clínica?", answer: "Es una técnica de relajación guiada para pacientes con miedo, fobia o ansiedad al dentista. No te duermes ni pierdes el control: estás despierto, tranquilo y puedes pedir una pausa cuando quieras. Se combina con la anestesia de siempre." },
    { kind: "qa", question: "¿Cómo se paga?", answer: "Efectivo, Yape, Plin, transferencia o tarjeta. Tratamientos de más de S/ 600 se pueden pagar en dos partes. Damos boleta o factura." },
    { kind: "qa", question: "¿Trabajan con seguros?", answer: "Por ahora no tenemos convenio con aseguradoras ni EPS. Te damos la boleta o factura y el informe para que pidas el reembolso." },
    { kind: "qa", question: "¿Después de la endodoncia qué sigue?", answer: "Casi siempre el diente necesita una corona o una restauración para no fracturarse. La puede hacer tu dentista de cabecera con el informe que te damos, o la hacemos aquí." },
  ],
  agent: {
    name: "Clara",
    tone: "Cercana, calmada y empática, como la asistente de un consultorio que sabe que muchas personas llegan con dolor o con miedo. Trata de tú salvo que el paciente use usted. Mensajes cortos y sin tecnicismos.",
    instructions:
      "Ayuda a agendar una evaluación o una cita. Si el paciente tiene dolor, ofrece el primer horario disponible. Si nombra a un profesional, agenda con esa persona. Si no, elige según lo que pide, sin suponer un diagnóstico: dolor, evaluación, endodoncia o retratamiento con endodoncia u odontología general; limpieza, resina o blanqueamiento con odontología general; niños con odontopediatría; brackets o alineadores con ortodoncia; encías con periodoncia; muelas del juicio o implantes con cirugía bucal; coronas o prótesis con rehabilitación oral. Da precios en soles solo si están en el conocimiento y aclara que el precio final se confirma en la evaluación. Si cuenta que tiene miedo, tranquilízalo y explica la atención para pacientes con ansiedad. Nunca des un diagnóstico, no recetes medicamentos ni digas qué tratamiento necesita: eso lo decide el doctor al verlo. Tampoco interpretes síntomas ni fotos: no digas que algo «suele ser señal de», «indica», «puede ser» o «suena a» una caries, el nervio o una infección, ni si un diente se puede salvar o si puede esperar. Ante un síntoma, muestra empatía y ofrece la evaluación; no supongas que su caso es una endodoncia: el precio de la evaluación va primero y los de cada tratamiento solo si los pide, aclarando que el doctor confirma qué necesita.",
    escalationRules:
      "Pasa la conversación a una persona de inmediato si hay hinchazón de la cara, fiebre, sangrado que no para, pus o una bolita en la encía, un golpe o un diente roto, o dificultad para tragar o respirar. Al pasarla, no expliques qué puede ser ni cómo evoluciona: solo di que lo atienden con prioridad. También si pide hablar con el doctor, si hay un reclamo, si pregunta por un medicamento o si es un paciente en tratamiento.",
    greeting: "¡Hola! Soy Clara, de Clínica Dental Calma 🦷 Cuéntame, ¿tienes alguna molestia o quieres agendar una evaluación?",
  },
  // 1029 — Ten professionals with staggered hours, all inside the business hours.
  // «Primero libre»: Clara offers whoever is free unless the patient names someone.
  agenda: {
    weeklyHours: BUSINESS_HOURS,
    slotMinutes: 60,
    agentResourceMode: "first_free",
    resources: [
      { kind: "person", name: "Dra. Lucía Paredes (endodoncia)", weeklyHours: days(WEEKDAYS, "08:00", "14:00") },
      { kind: "person", name: "Dr. Martín Quispe (endodoncia)", weeklyHours: days(WEEKDAYS, "12:00", "18:00") },
      {
        kind: "person",
        name: "Dra. Carla Benavides (endodoncia)",
        weeklyHours: { ...days(["tue", "thu"], "08:00", "18:00"), sat: [{ start: "08:00", end: "14:00" }] },
      },
      { kind: "person", name: "Dr. Andrés Villanueva (odontología general)", weeklyHours: days(WEEKDAYS, "08:00", "18:00") },
      {
        kind: "person",
        name: "Dra. Rosa Huamán (odontología general)",
        weeklyHours: { ...days(["mon", "wed", "fri"], "08:00", "18:00"), sat: [{ start: "08:00", end: "14:00" }] },
      },
      {
        kind: "person",
        name: "Dra. Valeria Rojas (odontopediatría)",
        weeklyHours: { ...days(["tue", "thu"], "14:00", "18:00"), sat: [{ start: "08:00", end: "14:00" }] },
      },
      {
        kind: "person",
        name: "Dr. Jorge Castañeda (ortodoncia)",
        weeklyHours: { ...days(["mon", "wed"], "14:00", "18:00"), sat: [{ start: "08:00", end: "12:00" }] },
      },
      { kind: "person", name: "Dra. Milagros Torres (periodoncia)", weeklyHours: days(["tue", "thu"], "08:00", "13:00") },
      { kind: "person", name: "Dr. Renato Cárdenas (cirugía bucal)", weeklyHours: days(["wed", "fri"], "08:00", "13:00") },
      { kind: "person", name: "Dra. Fiorella Lazo (rehabilitación oral)", weeklyHours: days(["mon", "thu"], "13:00", "18:00") },
    ],
  },
};
