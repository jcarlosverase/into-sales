/**
 * 025 — El orden en que el agente incluido lee la conversación cuando el
 * cliente escribió mientras pensaba. Puras: no tocan la base.
 *
 * Puerto de `src/server/ai/orden-turno.ts` de Vocero Cloud. Allá los debidos
 * los trae el despacho; aquí, la entrada de coalesce de `pipeline.ts`.
 */

type Message = { id: string; direction: "in" | "out"; createdAt: Date };

/**
 * Pura: el historial en el orden en que lo debe leer el modelo.
 *
 * Por hora de llegada, lo que el cliente escribió mientras el agente pensaba
 * queda ANTES de la respuesta que salió de ese turno: usuario, usuario,
 * asistente. Leído así, el modelo ve una conversación que termina en su
 * propia respuesta y da por contestado un mensaje que nunca leyó.
 *
 * `debidos` son los entrantes que este turno tiene que atender. Van al final
 * junto con lo que llegó después de la última respuesta, en su orden; el resto
 * se queda como estaba. Sin `debidos` no se mueve nada: el Laboratorio y el
 * turno normal leen el historial igual que siempre.
 */
export function sortForTurn<T extends Message>(
  history: readonly T[],
  owed: readonly T[]
): T[] {
  if (!owed.length) return [...history];

  const lastOutput = history.reduce(
    (idx, m, i) => (m.direction === "out" ? i : idx),
    -1
  );
  const unhandled = new Map<string, T>();
  for (const m of owed) {
    if (m.direction === "in") unhandled.set(m.id, m);
  }
  history.forEach((m, i) => {
    if (i > lastOutput && m.direction === "in") unhandled.set(m.id, m);
  });

  const queue = [...unhandled.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  return [...history.filter((m) => !unhandled.has(m.id)), ...queue];
}

/**
 * Pura: de lo debido, lo que ninguna PERSONA contestó ya.
 *
 * Un debido sigue debiéndose aunque después venga una respuesta del agente
 * (no lo había leído). Si lo que viene después es un saliente de una persona,
 * ese mensaje ya tuvo quien lo atendiera: moverlo al final sería hacer que el
 * agente le conteste encima.
 *
 * Se decide por la posición en el historial, que viene ordenado por Postgres;
 * la hora solo desempata un debido tan viejo que ya no cabe en él.
 */
export function currentOwed<T extends Message & { aiGenerated: boolean }>(
  history: readonly T[],
  owed: readonly T[]
): T[] {
  const lastHuman = history.reduce(
    (idx, m, i) => (m.direction === "out" && !m.aiGenerated ? i : idx),
    -1
  );
  const human = history[lastHuman];
  if (!human) return [...owed];

  const position = new Map(history.map((m, i) => [m.id, i]));
  return owed.filter((m) => {
    const i = position.get(m.id);
    return i === undefined
      ? m.createdAt.getTime() > human.createdAt.getTime()
      : i > lastHuman;
  });
}

/**
 * Pura: ¿lo último que pasó en la conversación es que contestó una PERSONA?
 *
 * Entra un mensaje y, antes de que venza la ventana de agrupado, el operador
 * responde desde la bandeja. Ese mensaje ya está atendido: un turno del agente
 * sería contestarle encima. Con el despacho, esto mismo deja la ráfaga vacía
 * y el despacho se descarta.
 */
export function handledByPerson(
  history: readonly { direction: "in" | "out"; aiGenerated: boolean }[]
): boolean {
  const lastHuman = history.reduce(
    (idx, m, i) => (m.direction === "out" && !m.aiGenerated ? i : idx),
    -1
  );
  if (lastHuman === -1) return false;
  return !history.some((m, i) => i > lastHuman && m.direction === "in");
}

/**
 * Pura: ¿hace falta otro turno?
 *
 * `anotados` es lo que entró mientras el turno corría; `vistos`, los entrantes
 * que ese turno alcanzó a leer (`undefined` si no llegó a abrir el historial:
 * falló o se calló antes). Lo que entró y el turno ya leyó está atendido: otro
 * turno sería contestar dos veces. Lo que no leyó se le sigue debiendo.
 */
export function remainingOwed(
  noted: ReadonlySet<string>,
  seen: readonly string[] | undefined
): string[] {
  if (!seen) return [...noted];
  const read = new Set(seen);
  return [...noted].filter((id) => !read.has(id));
}
