/**
 * Self-test E2E de comportamiento — conduce la app real en localhost con los
 * mocks (wa-mock + ai-mock) por las superficies de usuario, en vez de darle
 * el guion al humano. Cubre tests/e2e/us-bsuid.md y tests/e2e/us-bot-api.md.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      BOT_API_KEY configurada y BD migrada
 *   2) node --env-file=.env scripts/e2e-selftest.mjs
 *
 * Sale con código 1 si algún check falla (apto para CI o para el gate previo
 * a declarar "Hecho").
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY;

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

function bot(path, opts = {}) {
  return api(path, {
    ...opts,
    headers: { "x-api-key": BOT_KEY ?? "", ...(opts.headers ?? {}) },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que algo OCURRA, en vez de dormir un rato y confiar.
 *
 * Un `sleep` fijo convierte cualquier lentitud —la primera compilación de una
 * ruta en `next dev`, por ejemplo— en un fallo que no significa nada. Y si se
 * pone generoso, alarga el guion entero para todos.
 */
async function until(cond, ms = 15000, step = 400) {
  const end = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > end) return false;
    await sleep(step);
  }
}
const PN = "PN-E2E-1";

async function main() {
  if (!BOT_KEY || BOT_KEY.length < 16) {
    console.error(
      "BOT_API_KEY ausente o corta (<16): los checks de /api/bot/* no pueden correr."
    );
    process.exit(1);
  }

  console.log("== Setup: registro/login + conexión WhatsApp ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    // Re-corrida: el registro se cierra tras la primera organización.
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  await guideChecks();

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({
      wabaId: "WABA-E2E",
      phoneNumberId: PN,
      token: "tok-e2e",
    }),
  });
  ok(
    "conexión WhatsApp guardada (vía wa-mock)",
    conn.res.ok,
    JSON.stringify(conn.json)
  );
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  await overrideChecks();

  console.log("\n== us-bsuid: inbound sin wa_id ==");
  const inb1 = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  ok("inbound BSUID entregado", inb1.res.ok, JSON.stringify(inb1.json));
  await sleep(1200);

  let convs = (await api("/api/conversations")).json?.conversations ?? [];
  const bsuidConv = convs.find((c) => c.contact.name === "Dueña Dental");
  ok("conversación con nombre de perfil (no el BSUID crudo)", !!bsuidConv);
  ok("contacto BSUID sin teléfono", bsuidConv?.contact.phone === null);

  const reply = await api(`/api/conversations/${bsuidConv?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "¡Hola! Te atendemos enseguida" }),
  });
  ok("respuesta a contacto BSUID enviable", reply.res.ok, JSON.stringify(reply.json));

  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  /**
   * Esta comprobación fijaba el comportamiento EQUIVOCADO: afirmaba que el
   * BSUID viaja en `to`. Y pasaba, porque el mock aceptaba cualquier cosa ahí
   * — mientras Meta respondía 131026 en producción. Un test verde sobre un
   * mock permisivo es peor que no tenerlo: convence de lo contrario.
   */
  ok(
    "el destinatario del envío es el BSUID, en `recipient`",
    outbox.some((o) => o.recipient === "bsu_e2e_1" && !o.to),
    JSON.stringify(outbox.map((o) => ({ to: o.to, recipient: o.recipient })))
  );

  // Idempotencia: re-entrega del mismo wa_message_id
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      fromUserId: "bsu_e2e_1",
      name: "Dueña Dental",
      text: "hola, vi su anuncio",
      waMessageId: "wamid.e2e.bsuid.1",
    }),
  });
  await sleep(800);
  const msgs =
    (await api(`/api/conversations/${bsuidConv?.id}/messages`)).json?.messages ??
    [];
  const inCount = msgs.filter((m) => m.direction === "in").length;
  ok("webhook duplicado no duplica mensajes", inCount === 1, `in=${inCount}`);

  console.log("\n== us-bsuid: a un contacto sin teléfono se le puede responder ==");
  {
    /**
     * El caso de produccion que dejo mudo al agente de un miembro.
     *
     * Meta omite el telefono cuando coinciden TRES condiciones: el usuario
     * activo su nombre de usuario, no hubo interaccion con ese numero de
     * empresa en 30 dias, y no esta en la agenda. Entonces solo llega el
     * BSUID — y hay que responderle por `recipient`, no por `to`: en `to`
     * Meta espera un telefono y devuelve 131026, que en la bandeja se lee
     * como si el numero del cliente no existiera.
     */
    const conv = bsuidConv;
    if (!conv) {
      ok("hay conversacion BSUID para responder", false, "no aparecio");
    } else {
      const sending = await api(`/api/conversations/${conv.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "respuesta a un BSUID" }),
      });
      ok("se le PUEDE responder (antes: Meta 131026)", sending.res.ok,
        `status=${sending.res.status} ${JSON.stringify(sending.json)}`);

      const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
      const output = outbox[outbox.length - 1];
      ok("y el BSUID viaja en `recipient`, nunca en `to`",
        output?.recipient === "bsu_e2e_1" && !output?.to,
        `to=${JSON.stringify(output?.to)} recipient=${JSON.stringify(output?.recipient)}`);
    }
  }

  console.log("\n== us-bsuid: reconciliación 521/52 ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: "5215550001234",
      name: "Kevin MX",
      text: "uno",
    }),
  });
  await sleep(800);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from: "525550001234", text: "dos" }),
  });
  await sleep(800);
  const contacts =
    (await api("/api/contacts?q=Kevin%20MX")).json?.contacts ?? [];
  ok(
    "521 y 52 resuelven a UN solo contacto",
    contacts.length === 1,
    `n=${contacts.length}`
  );

  const mxConv = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Kevin MX"
  );
  ok("el contacto reconciliado conserva su conversación", !!mxConv);

  // Issue #35: un destinatario argentino llega como `549` + 10 dígitos y hay
  // que ENVIARLE sin el 9. La identidad, en cambio, conserva lo que Meta
  // reporta: si se reescribiera, dejaría de casar con el `wa_id` de cada
  // webhook y el contacto se partiría en dos.
  console.log("\n== us-bsuid: destinatario argentino (549 → 54) ==");
  const AR_REPORTED = "5491122334455";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: AR_REPORTED,
      name: "Lead AR",
      text: "hola desde Argentina",
      waMessageId: "wamid.e2e.ar.1",
    }),
  });
  await sleep(1200);
  const convAr = ((await api("/api/conversations")).json?.conversations ?? []).find(
    (c) => c.contact.name === "Lead AR"
  );
  ok("la conversación argentina se creó", Boolean(convAr));
  ok(
    "la identidad guardada conserva el 9 que reporta Meta",
    convAr?.contact.phone === AR_REPORTED,
    `phone=${convAr?.contact.phone}`
  );

  if (convAr) {
    // Se cuenta lo que ya había en vez de vaciar el outbox: el DELETE del
    // wa-mock reinicia su contador de wa_message_id, y en una RE-CORRIDA eso
    // choca con los mensajes que ya están en la base (unique) y tumba el envío
    // con un 500 que no tiene nada que ver con lo que se está probando.
    const outboxBefore =
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
    const sendAr = await api(`/api/conversations/${convAr.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: "respuesta a Argentina" }),
    });
    ok("el mensaje a Argentina se envía", sendAr.res.ok, `status=${sendAr.res.status}`);
    const outboxAr = (
      (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []
    ).slice(outboxBefore);
    ok(
      "por el cable viaja SIN el 9 (lo que la lista de permitidos acepta)",
      outboxAr.some((o) => o.to === "541122334455"),
      JSON.stringify(outboxAr.map((o) => o.to))
    );
    ok(
      "…y nunca con el 9, que es lo que devolvía 131030",
      !outboxAr.some((o) => o.to === AR_REPORTED),
      JSON.stringify(outboxAr.map((o) => o.to))
    );
  }

  console.log("\n== #51: el nombre del contacto sigue al perfil, salvo si lo escribió alguien ==");
  {
    const N = Date.now().toString().slice(-6);
    const TEL = `5214627${N}`;
    const say = (nameValue, i) =>
      api("/api/dev/wa-mock/inbound", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: PN,
          from: TEL,
          name: nameValue,
          text: `hola ${i}`,
          waMessageId: `wamid.e2e.51.${N}.${i}`,
        }),
      });
    const contactOf = async () => {
      const cs = (await api("/api/contacts")).json?.contacts ?? [];
      return cs.find((c) => c.phone === `524627${N}`) ?? null;
    };

    await say("Federico", 1);
    await until(async () => Boolean(await contactOf()));
    const created = await contactOf();
    ok("el contacto nace con el nombre del perfil", created?.name === "Federico",
      `nombre: ${created?.name}`);

    // El caso reportado: cambia su nombre de WhatsApp y vuelve a escribir.
    await say("Federicoso", 2);
    await until(async () => (await contactOf())?.name === "Federicoso");
    ok("cambiar el nombre de WhatsApp actualiza el contacto",
      (await contactOf())?.name === "Federicoso",
      `nombre: ${(await contactOf())?.name}`);

    // Y lo que NO puede pasar: que el perfil pise lo que escribió una persona.
    const edited = await api(`/api/contacts/${created?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Fede - obra Polanco" }),
    });
    ok("el operador puede renombrar a mano", edited.res.ok, edited.text);

    await say("Federicoso", 3);
    await sleep(1500);
    ok("y WhatsApp ya no pisa ese nombre",
      (await contactOf())?.name === "Fede - obra Polanco",
      `nombre: ${(await contactOf())?.name}`);
  }

  console.log("\n== us-bot-api: autorización ==");
  const noKey = await api("/api/bot/media/media123");
  ok("media sin API key → 401", noKey.res.status === 401);
  const badKey = await api("/api/bot/media/media123", {
    headers: { "x-api-key": "x".repeat(BOT_KEY.length) },
  });
  ok("media con API key equivocada → 401", badKey.res.status === 401);
  const resetNoKey = await api("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: mxConv?.id }),
  });
  ok("reset sin API key → 401", resetNoKey.res.status === 401);

  console.log("\n== us-bot-api: typing + leído ==");
  const convId = mxConv?.id;
  const outboxBeforeTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const typ = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/typing → ok:true (leído + escribiendo…)",
    typ.res.ok && typ.json?.ok === true,
    JSON.stringify(typ.json)
  );
  const outboxAfterTyping =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "typing NO contamina el outbox",
    outboxAfterTyping === outboxBeforeTyping,
    `antes=${outboxBeforeTyping} después=${outboxAfterTyping}`
  );

  const typ404 = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe" }),
  });
  ok("typing con conversación inexistente → 404", typ404.res.status === 404);

  console.log("\n== us-bot-api: media proxy ==");
  const med = await bot("/api/bot/media/media123");
  const medBytes = med.res.ok ? await med.res.arrayBuffer() : new ArrayBuffer(0);
  ok(
    "GET /api/bot/media/{id} → binario con content-type",
    med.res.ok &&
      medBytes.byteLength > 0 &&
      (med.res.headers.get("content-type") ?? "").includes("image"),
    `status=${med.res.status} bytes=${medBytes.byteLength}`
  );
  const medBad = await bot("/api/bot/media/no-es-media");
  ok(
    "mediaId que Graph no reconoce → error tipado, no 500",
    medBad.res.status === 404 || medBad.res.status === 502,
    `status=${medBad.res.status}`
  );

  console.log("\n== us-bot-api: perfil del agente + knowledge base ==");
  const profNoKey = await api("/api/bot/profile");
  ok("perfil sin API key → 401", profNoKey.res.status === 401);

  const putProf = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({
      name: "Sofi",
      tone: "cálido y directo",
      instructions: "Vendemos limpiezas dentales.",
      escalationRules: "Urgencias de dolor → humano.",
      greeting: "¡Hola! Soy Sofi",
      enabled: false,
    }),
  });
  ok("perfil guardado desde la pantalla Agente", putProf.res.ok);
  const kbQa = await api("/api/kb", {
    method: "POST",
    body: JSON.stringify({
      kind: "qa",
      question: "¿Cuánto cuesta?",
      answer: "$800.",
    }),
  });
  ok("entrada de KB creada desde la pantalla", kbQa.res.ok, JSON.stringify(kbQa.json));

  const prof = await bot("/api/bot/profile");
  ok(
    "GET /api/bot/profile → 200 con el perfil de la pantalla",
    prof.res.ok && prof.json?.profile?.name === "Sofi",
    JSON.stringify(prof.json?.profile)
  );
  ok(
    "el knowledge base viaja renderizado (P:/R:)",
    typeof prof.json?.kb === "string" && prof.json.kb.includes("P: ¿Cuánto cuesta?"),
    JSON.stringify(prof.json?.kb)
  );
  ok(
    "`enabled` NO viaja: gobierna la IA in-process, no al bot externo",
    prof.json?.profile && !("enabled" in prof.json.profile)
  );
  ok("`resources` presente y vacío", Array.isArray(prof.json?.resources));

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ tone: "seco y breve" }),
  });
  const profAgain = await bot("/api/bot/profile");
  ok(
    "editar el tono se refleja al instante (sin caché)",
    profAgain.json?.profile?.tone === "seco y breve",
    JSON.stringify(profAgain.json?.profile?.tone)
  );

  console.log("\n== us-bot-api: contexto conversacional ==");
  const ctxNoKey = await api(`/api/bot/context?conversationId=${convId}`);
  ok("contexto sin API key → 401", ctxNoKey.res.status === 401);

  const ctx = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "GET /api/bot/context por conversationId → 200",
    ctx.res.ok && ctx.json?.conversation?.id === convId,
    JSON.stringify(ctx.json?.conversation)
  );
  ok(
    "trae la identidad estable del contacto (no solo el teléfono)",
    typeof ctx.json?.contact?.waIdentity === "string" &&
      ctx.json.contact.waIdentity.length > 0
  );
  ok(
    "trae la etapa del lead en el pipeline",
    typeof ctx.json?.lead?.stageName === "string",
    JSON.stringify(ctx.json?.lead)
  );
  ok(
    "la ventana de 24 h viaja abierta tras un entrante reciente",
    ctx.json?.conversation?.windowOpen === true &&
      ctx.json?.conversation?.windowRemainingMs > 0,
    JSON.stringify(ctx.json?.conversation)
  );

  // 015 — `booking` es aditivo y solo existe con la agenda encendida. Un
  // cerebro lo tolera ausente (no afirma nada sobre citas); lo que no puede
  // recibir es un bloque vacío en una instancia SIN agenda, porque lo leería
  // como «este lead no tiene cita».
  if (/^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim())) {
    const b = ctx.json?.booking;
    ok(
      "con la agenda encendida el contexto trae `booking` (sin citas: las tres vacías)",
      typeof b?.timezone === "string" &&
        b.next === null &&
        b.unresolved === null &&
        b.lastClosed === null,
      JSON.stringify(b)
    );
  } else {
    ok(
      "con la agenda apagada el contexto NO trae `booking`, ni vacío",
      Boolean(ctx.json) && !("booking" in ctx.json),
      JSON.stringify(Object.keys(ctx.json ?? {}))
    );
  }

  const ctxByIdentity = await bot(
    `/api/bot/context?waIdentity=${encodeURIComponent(ctx.json.contact.waIdentity)}`
  );
  ok(
    "resolver por waIdentity da la MISMA conversación",
    ctxByIdentity.json?.conversation?.id === convId,
    JSON.stringify(ctxByIdentity.json?.conversation?.id)
  );

  const ctxWithoutArgs = await bot("/api/bot/context");
  ok("contexto sin waIdentity ni conversationId → 422", ctxWithoutArgs.res.status === 422);
  const ctx404 = await bot("/api/bot/context?conversationId=cv_no_existe");
  ok("contexto de una conversación inexistente → 404", ctx404.res.status === 404);

  console.log("\n== us-bot-api: ficha de calificación ==");
  const qualificationNoKey = await api("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId, ficha: { rubro: "x" } }),
  });
  ok("ficha sin API key → 401", qualificationNoKey.res.status === 401);

  const f1 = await bot("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { rubro: "dentista", geo: "Querétaro", calificado: true },
    }),
  });
  ok(
    "PUT /api/bot/qualification → 200 con la ficha completa",
    f1.res.ok && f1.json?.ficha?.rubro === "dentista",
    JSON.stringify(f1.json)
  );
  ok(
    "las claves las pone el negocio: el CRM guarda lo que le manden",
    f1.json?.ficha?.geo === "Querétaro" && f1.json?.ficha?.calificado === true,
    JSON.stringify(f1.json?.ficha)
  );

  const ctxWithQualification = await bot(`/api/bot/context?conversationId=${convId}`);
  ok(
    "la ficha viaja en el contexto del siguiente turno",
    ctxWithQualification.json?.contact?.ficha?.rubro === "dentista",
    JSON.stringify(ctxWithQualification.json?.contact?.ficha)
  );

  const f2 = await bot("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { presupuesto: "20 mil", geo: null },
    }),
  });
  ok(
    "merge campo a campo: lo ausente se conserva",
    f2.json?.ficha?.rubro === "dentista" && f2.json?.ficha?.presupuesto === "20 mil",
    JSON.stringify(f2.json?.ficha)
  );
  ok(
    "null explícito borra la clave",
    f2.json?.ficha && !("geo" in f2.json.ficha),
    JSON.stringify(f2.json?.ficha)
  );

  const fJunk = await bot("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({
      conversationId: convId,
      ficha: { anidado: { a: 1 }, empty: "", good: "  sí  " },
    }),
  });
  ok(
    "lo que no se entiende se ignora sin 422 (no se le tiran datos al bot)",
    fJunk.res.ok &&
      fJunk.json?.ficha?.good === "sí" &&
      !("anidado" in fJunk.json.ficha) &&
      !("vacío" in fJunk.json.ficha),
    JSON.stringify(fJunk.json?.ficha)
  );

  const fNoConv = await bot("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({ conversationId: "cv_no_existe", ficha: { a: "b" } }),
  });
  ok("ficha de conversación inexistente → 404", fNoConv.res.status === 404);
  const fWithoutQualification = await bot("/api/bot/qualification", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok("cuerpo sin `ficha` → 422", fWithoutQualification.res.status === 422);
  // La URL de siempre sigue respondiendo (contrato con los cerebros externos):
  // next.config la reescribe a /api/bot/qualification.
  const fLegacy = await bot("/api/bot/ficha", {
    method: "PUT",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok("la URL de siempre /api/bot/ficha sigue respondiendo (→ 422 sin `ficha`)", fLegacy.res.status === 422, `status=${fLegacy.res.status}`);

  console.log("\n== us-bot-api: el bot envía a través del CRM ==");
  const sendNoKey = await api("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "hola" }),
  });
  ok("envío sin API key → 401", sendNoKey.res.status === 401);

  const outboxBeforeBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const botSend = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "Hola, soy el bot." }),
  });
  ok(
    "POST /api/bot/messages → 200 con messageId",
    botSend.res.ok && typeof botSend.json?.messageId === "string",
    JSON.stringify(botSend.json)
  );
  const outboxAfterBot =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "el mensaje salió de verdad por el canal de WhatsApp",
    outboxAfterBot === outboxBeforeBot + 1,
    `antes=${outboxBeforeBot} después=${outboxAfterBot}`
  );
  const botMsg = ((await api(`/api/conversations/${convId}/messages`)).json
    ?.messages ?? []).find((m) => m.id === botSend.json?.messageId);
  ok(
    "queda en la bandeja marcado como IA (aiGenerated + origin=ai)",
    botMsg?.aiGenerated === true && botMsg?.origin === "ai",
    JSON.stringify({ aiGenerated: botMsg?.aiGenerated, origin: botMsg?.origin })
  );
  const sendNoConv = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", text: "hola" }),
  });
  ok("envío a conversación inexistente → 404", sendNoConv.res.status === 404);
  const sendEmpty = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "" }),
  });
  ok("texto vacío → 422 (no se manda un mensaje en blanco)", sendEmpty.res.status === 422);

  // Regresión: la hora del saliente debe ser la misma en las dos vistas.
  // Las columnas se llenan por dos caminos: `now()` de los `defaultNow()` y
  // `Date` desde JS. Con el viejo `timestamp without time zone`, una sesión
  // fuera de UTC desfasaba `message.created_at` (burbuja del hilo) de
  // `conversation.last_message_at` (lista). Desde 1002 son `timestamptz` y la
  // base está en hora de Lima: las dos tienen que seguir coincidiendo.
  console.log("\n== zona horaria: la misma hora en la lista y en el hilo ==");
  const convTz = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  const minutes = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 60000;
  ok(
    "el saliente trae la misma hora en el hilo y en la lista",
    convTz?.lastMessageAt !== undefined &&
      botMsg?.createdAt !== undefined &&
      minutes(convTz.lastMessageAt, botMsg.createdAt) < 5,
    JSON.stringify({
      thread: botMsg?.createdAt,
      list: convTz?.lastMessageAt,
    })
  );
  ok(
    "y esa hora es la de ahora, no la del huso del servidor de BD",
    botMsg?.createdAt !== undefined &&
      minutes(new Date().toISOString(), botMsg.createdAt) < 5,
    JSON.stringify({ thread: botMsg?.createdAt, now: new Date().toISOString() })
  );

  console.log("\n== us-bot-api: el bot pide un humano ==");
  const hoNoKey = await api("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  ok("handoff sin API key → 401", hoNoKey.res.status === 401);

  const ho = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "hostilidad" }),
  });
  ok("POST /api/bot/handoff → 200", ho.res.ok && ho.json?.ok === true);
  await sleep(300);
  let convAfterHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "la conversación queda pausada y con su motivo",
    convAfterHandoff?.aiEnabled === false &&
      !!convAfterHandoff?.handoffAt &&
      convAfterHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      aiEnabled: convAfterHandoff?.aiEnabled,
      reason: convAfterHandoff?.handoffReason,
    })
  );
  const firstHandoffAt = convAfterHandoff?.handoffAt;

  const hoRepe = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "cliente" }),
  });
  await sleep(300);
  convAfterHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "repetir el handoff es idempotente: no pisa la hora ni el motivo original",
    hoRepe.res.ok &&
      convAfterHandoff?.handoffAt === firstHandoffAt &&
      convAfterHandoff?.handoffReason === "hostilidad",
    JSON.stringify({
      before: firstHandoffAt,
      now: convAfterHandoff?.handoffAt,
      reason: convAfterHandoff?.handoffReason,
    })
  );

  const hoNoConv = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: "cv_no_existe", reason: "cliente" }),
  });
  ok("handoff de conversación inexistente → 404", hoNoConv.res.status === 404);

  // El handoff jamás debe perderse por un motivo que no esté en el catálogo:
  // el bot se quedaría hablándole a alguien que pidió un humano.
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoOdd = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, reason: "porque sí" }),
  });
  await sleep(300);
  convAfterHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "un motivo fuera del catálogo NO tira el handoff (cae a 'modelo')",
    hoOdd.res.ok &&
      convAfterHandoff?.aiEnabled === false &&
      convAfterHandoff?.handoffReason === "modelo",
    JSON.stringify({
      status: hoOdd.res.status,
      reason: convAfterHandoff?.handoffReason,
    })
  );

  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  const hoWithoutReason = await bot("/api/bot/handoff", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);
  convAfterHandoff = ((await api("/api/conversations")).json?.conversations ?? [])
    .find((c) => c.id === convId);
  ok(
    "sin motivo también pausa (cae a 'modelo')",
    hoWithoutReason.res.ok && convAfterHandoff?.handoffReason === "modelo",
    JSON.stringify(convAfterHandoff?.handoffReason)
  );
  await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  await sleep(300);

  console.log("\n== us-bot-api: IA pausada y reset ==");
  const pause = await api(`/api/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ aiEnabled: false }),
  });
  ok("IA pausada desde la bandeja", pause.res.ok, JSON.stringify(pause.json));

  const typPaused = await bot("/api/bot/typing", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "typing con IA pausada → ok:false ai_paused (no toca Meta)",
    typPaused.res.ok &&
      typPaused.json?.ok === false &&
      typPaused.json?.reason === "ai_paused",
    JSON.stringify(typPaused.json)
  );

  const outboxBeforePaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  const sendPaused = await bot("/api/bot/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId, text: "¿sigo yo?" }),
  });
  ok(
    "el bot NO habla sobre una conversación tomada por un humano → 409 ai_paused",
    sendPaused.res.status === 409 &&
      sendPaused.json?.error?.code === "ai_paused",
    JSON.stringify(sendPaused.json)
  );
  const outboxAfterPaused =
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).length;
  ok(
    "y el rechazo ocurre ANTES de tocar Meta",
    outboxAfterPaused === outboxBeforePaused,
    `antes=${outboxBeforePaused} después=${outboxAfterPaused}`
  );

  const msgsBeforeReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  const rst = await bot("/api/bot/reset", {
    method: "POST",
    body: JSON.stringify({ conversationId: convId }),
  });
  ok(
    "POST /api/bot/reset → ok:true",
    rst.res.ok && rst.json?.ok === true,
    JSON.stringify(rst.json)
  );
  await sleep(400);
  convs = (await api("/api/conversations")).json?.conversations ?? [];
  const afterReset = convs.find((c) => c.id === convId);
  ok(
    "reset reactiva la IA (sale del handoff)",
    afterReset?.aiEnabled === true && !afterReset?.handoffAt,
    JSON.stringify({
      aiEnabled: afterReset?.aiEnabled,
      handoffAt: afterReset?.handoffAt,
    })
  );
  const msgsAfterReset =
    ((await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [])
      .length;
  ok(
    "el reset conserva el historial (auditoría)",
    msgsAfterReset === msgsBeforeReset,
    `antes=${msgsBeforeReset} después=${msgsAfterReset}`
  );

  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
  const detail = (await api(`/api/contacts/${afterReset?.contact.id}`)).json;
  ok(
    "reset regresa el lead a la primera etapa",
    !detail?.lead || detail?.stage?.id === firstStage?.id,
    `etapa=${detail?.stage?.name} esperada=${firstStage?.name}`
  );

  await whoAnswersChecks(convId);

  console.log("\n== FR-022: pedir un humano no deja al cliente en silencio ==");
  {
    /**
     * El patrón de respaldo (antes del modelo) traspasaba SIN mandar nada: el
     * cliente que escribía «quiero hablar con un humano» no recibía respuesta,
     * aunque por dentro el traspaso sí ocurría. Lo encontró @fondeur27-09-73
     * (#62).
     *
     * El ai-mock, si le llegara esta frase, traspasaría SIN `farewell` y con
     * motivo `modelo`. Así que el motivo `cliente` prueba que decidió el
     * patrón, y el saliente prueba el arreglo: con el bug hay cero mensajes.
     *
     * Hay que ENCENDER el agente in-process a propósito, y apagarlo al final
     * para no alterar lo que sigue.
     */
    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });

    // Contacto nuevo por corrida: con uno fijo, la segunda ejecución lo
    // encontraría ya traspasado y el agente no llegaría a correr.
    const RUN_VALUE = Date.now().toString().slice(-6);
    const TEL = `5214628${RUN_VALUE}`;
    const CANONICAL = `524628${RUN_VALUE}`;
    const say = (text, n) =>
      api("/api/dev/wa-mock/inbound", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: PN,
          from: TEL,
          name: "Lead pide humano",
          text: text,
          waMessageId: `wamid.e2e.022.${RUN_VALUE}.${n}`,
        }),
      });
    const convDe = async () =>
      ((await api("/api/conversations")).json?.conversations ?? []).find(
        (c) => c.contact.phone === CANONICAL
      );
    const outboundOf = async (id) =>
      ((await api(`/api/conversations/${id}/messages`)).json?.messages ?? []).filter(
        (m) => m.direction === "out"
      );
    const toCustomer = async () =>
      ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter(
        (o) => o.to === CANONICAL
      );

    await say("quiero hablar con un humano", 1);
    // Lo que se espera es el TRASPASO; cuánto tarde el debounce no es asunto
    // del check.
    await until(async () => Boolean((await convDe())?.handoffAt));
    const conv = await convDe();
    ok(
      "decide el patrón de respaldo, antes del modelo (motivo `cliente`)",
      Boolean(conv?.handoffAt) && conv?.handoffReason === "cliente",
      JSON.stringify({ handoffAt: conv?.handoffAt, reason: conv?.handoffReason })
    );

    if (conv) {
      const outbound = await outboundOf(conv.id);
      ok(
        "el cliente recibe un acuse antes del traspaso (antes: cero mensajes)",
        outbound.length === 1 && /persona del equipo/.test(outbound[0]?.text ?? ""),
        `salientes=${outbound.length} ${JSON.stringify(outbound.map((m) => m.text))}`
      );
      ok(
        "el acuse queda en la bandeja marcado como IA",
        outbound[0]?.aiGenerated === true && outbound[0]?.origin === "ai",
        JSON.stringify({ aiGenerated: outbound[0]?.aiGenerated, origin: outbound[0]?.origin })
      );
      const cable = await toCustomer();
      ok(
        "y salió de verdad por el canal de WhatsApp, al número del cliente",
        cable.length === 1 && JSON.stringify(cable[0]?.body).includes("persona del equipo"),
        `envíos=${cable.length}`
      );

      // Un turno nuevo sobre la conversación YA traspasada: su último
      // entrante vuelve a ser la frase del patrón, así que si el silencio del
      // traspaso no mandara, el acuse saldría otra vez.
      await say("sigo esperando, quiero hablar con un humano", 2);
      const coalesce = Number(process.env.AGENT_COALESCE_MS ?? 6000);
      await sleep(coalesce + 2500);
      ok(
        "tras el traspaso la IA calla: el acuse NO se repite",
        (await outboundOf(conv.id)).length === 1 && (await toCustomer()).length === 1,
        `salientes=${(await outboundOf(conv.id)).length} envíos=${(await toCustomer()).length}`
      );
    }

    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
  }

  console.log("\n== 008: paridad inbox — echoes de coexistence (US1) ==");
  const LEAD = "5214627008001"; // canónica: 524627008001

  // Un inbound primero: la conversación existe y la ventana queda abierta.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 008",
      text: "hola, quiero informes",
      waMessageId: "wamid.e2e.008.in.1",
    }),
  });
  await sleep(1200);
  const findConv008 = async () =>
    (((await api("/api/conversations")).json?.conversations) ?? []).find(
      (c) => c.contact.phone === "524627008001"
    );
  let conv008 = await findConv008();
  ok("conversación del lead 008 creada", Boolean(conv008), "sin conversación");
  const inboundAtBefore = conv008?.lastInboundAt;

  // Echo: el dueño contesta A MANO desde la app del teléfono.
  const echo1 = await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  ok("echo entregado al webhook", echo1.res.ok, JSON.stringify(echo1.json));
  await sleep(900);

  const msgs1 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const manual1 = msgs1.find((m) => m.text === "te contesto yo, dame un minuto");
  ok(
    "el mensaje manual aparece como saliente origin=manual",
    manual1?.direction === "out" && manual1?.origin === "manual" && manual1?.status === "sent",
    JSON.stringify(manual1)
  );

  // Se espera la pausa, no un tiempo fijo: el eco guarda el mensaje y DESPUÉS
  // pausa la IA. Leer la conversación entre un paso y otro —pasa con el
  // servidor recién arrancado— daba la IA encendida sin que nada fallara.
  await until(
    async () => {
      conv008 = await findConv008();
      return conv008?.handoffReason === "manual_reply";
    },
    5000,
    150
  );
  ok(
    "la IA quedó pausada con handoff manual_reply",
    conv008?.aiEnabled === false && conv008?.handoffReason === "manual_reply",
    JSON.stringify({ aiEnabled: conv008?.aiEnabled, reason: conv008?.handoffReason })
  );
  ok(
    "el echo NO tocó la ventana de 24 h (lastInboundAt intacto)",
    conv008?.lastInboundAt === inboundAtBefore,
    `${inboundAtBefore} → ${conv008?.lastInboundAt}`
  );

  // Idempotencia: el mismo echo otra vez no duplica.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "te contesto yo, dame un minuto",
      waMessageId: "wamid.e2e.008.echo.1",
    }),
  });
  await sleep(700);
  const msgs2 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo duplicado (mismo wamid) no duplica el mensaje",
    msgs2.filter((m) => m.text === "te contesto yo, dame un minuto").length === 1
  );

  // Variante defensiva: echoes bajo la clave `messages`.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      text: "segundo mensaje manual",
      waMessageId: "wamid.e2e.008.echo.2",
      useMessagesKey: true,
    }),
  });
  await sleep(700);
  const msgs3 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  ok(
    "echo bajo la clave `messages` también se ingiere (parser tolerante)",
    msgs3.some((m) => m.text === "segundo mensaje manual" && m.origin === "manual")
  );

  // Echo hacia un número SIN conversación previa → la crea.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: "5214627008002",
      text: "hola, te escribo del anuncio",
      waMessageId: "wamid.e2e.008.echo.3",
    }),
  });
  await sleep(700);
  const convNew = (((await api("/api/conversations")).json?.conversations) ?? []).find(
    (c) => c.contact.phone === "524627008002"
  );
  ok("echo a número nuevo crea contacto y conversación", Boolean(convNew));

  // Reactivación desde el CRM (flujo existente de handoff).
  const react = await api(`/api/conversations/${conv008.id}`, {
    method: "PATCH",
    body: JSON.stringify({ reactivate: true }),
  });
  conv008 = await findConv008();
  ok(
    "reactivar la IA desde el CRM limpia el handoff",
    react.res.ok && conv008?.aiEnabled === true && !conv008?.handoffReason
  );

  console.log("\n== 008: enviar adjuntos desde el composer (US2) ==");
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);
  const mediaForm = new FormData();
  mediaForm.set(
    "file",
    new Blob([JPEG_BYTES], { type: "image/jpeg" }),
    "local.jpg"
  );
  mediaForm.set("caption", "mira nuestro local");
  const upRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: mediaForm,
  });
  const upJson = await upRes.json().catch(() => null);
  ok("imagen con caption enviada (201)", upRes.status === 201, JSON.stringify(upJson));

  const msgs4 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentImg = msgs4.find((m) => m.media?.caption === "mira nuestro local");
  ok(
    "el saliente con imagen trae asset disponible y origin=operator",
    sentImg?.type === "image" &&
      sentImg?.origin === "operator" &&
      sentImg?.media?.fetchStatus === "available",
    JSON.stringify(sentImg)
  );

  const imgBin = await fetch(`${BASE}/api/media/${sentImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok(
    "GET /api/media/{id} sirve el binario con su content-type",
    imgBin.ok && (imgBin.headers.get("content-type") ?? "").includes("image/jpeg")
  );

  const outbox008 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "el envío llegó a Graph como type=image con media id subido",
    outbox008.some((o) => o.type === "image" && JSON.stringify(o.body).includes("media-up-"))
  );

  // Camino infeliz: archivo que excede el límite (imagen > 5 MB) → 413 previo.
  const bigForm = new FormData();
  bigForm.set(
    "file",
    new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "image/png" }),
    "grande.png"
  );
  const bigRes = await fetch(`${BASE}/api/conversations/${conv008.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: bigForm,
  });
  ok("imagen de 6 MB → 413 too_large ANTES de enviar", bigRes.status === 413);

  // Ubicación (payload estructurado, sin archivo).
  const locRes = await api(`/api/conversations/${conv008.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina Central" },
    }),
  });
  ok("ubicación enviada", locRes.res.ok, JSON.stringify(locRes.json));
  const msgs5 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const sentLoc = msgs5.find((m) => m.type === "location" && m.direction === "out");
  ok(
    "la ubicación viaja como payload (lat/long/name) sin binario",
    sentLoc?.media?.kind === "location" && sentLoc?.media?.payload?.latitude === 21.019,
    JSON.stringify(sentLoc?.media)
  );
  const outboxLoc = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok(
    "Graph recibió type=location",
    outboxLoc.some((o) => o.type === "location")
  );

  console.log("\n== 008: previews de adjuntos entrantes (US3) ==");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "media-e2e-img-1",
      caption: "foto de mi negocio",
      waMessageId: "wamid.e2e.008.in.img",
    }),
  });
  await sleep(1600); // ingesta + descarga in-process del binario
  const msgs6 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inImg = msgs6.find((m) => m.media?.caption === "foto de mi negocio");
  ok(
    "imagen entrante queda disponible tras la descarga in-process",
    inImg?.direction === "in" &&
      inImg?.media?.kind === "image" &&
      inImg?.media?.fetchStatus === "available",
    JSON.stringify(inImg?.media)
  );
  const inImgBin = await fetch(`${BASE}/api/media/${inImg?.media?.assetId}`, {
    headers: { cookie, origin: BASE },
  });
  ok("el binario entrante se sirve desde el volumen local", inImgBin.ok);

  // Ubicación entrante: payload directo, sin binario (404 en /api/media).
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "location",
      location: { latitude: 20.5, longitude: -100.8, name: "Mi taller" },
      waMessageId: "wamid.e2e.008.in.loc",
    }),
  });
  await sleep(900);
  const msgs7 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const inLoc = msgs7.find((m) => m.type === "location" && m.direction === "in");
  ok(
    "ubicación entrante trae payload directo",
    inLoc?.media?.payload?.name === "Mi taller",
    JSON.stringify(inLoc?.media)
  );

  // Camino infeliz: media cuya descarga falla (metadata sin url) → failed,
  // el mensaje se conserva y /api/media responde 410.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      type: "image",
      mediaId: "broken-no-url",
      waMessageId: "wamid.e2e.008.in.broken",
    }),
  });
  await sleep(1600);
  const msgs8 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const broken = msgs8.find((m) => m.id !== inImg?.id && m.media?.fetchStatus === "failed");
  ok(
    "descarga fallida degrada a failed sin perder el mensaje",
    Boolean(broken),
    JSON.stringify(msgs8.filter((m) => m.media).map((m) => m.media))
  );
  if (broken) {
    const goneRes = await fetch(`${BASE}/api/media/${broken.media.assetId}`, {
      headers: { cookie, origin: BASE },
    });
    ok("asset fallido → 410 gone en /api/media", goneRes.status === 410);
  }

  // Echo CON adjunto (AC-5 de US1): la foto que el dueño mandó desde el cel.
  await api("/api/dev/wa-mock/echo", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      to: LEAD,
      type: "image",
      mediaId: "media-e2e-echo-img",
      caption: "así quedaría tu logo",
      waMessageId: "wamid.e2e.008.echo.img",
    }),
  });
  await sleep(1600);
  const msgs9 = (await api(`/api/conversations/${conv008.id}/messages`)).json?.messages ?? [];
  const echoImg = msgs9.find((m) => m.media?.caption === "así quedaría tu logo");
  ok(
    "echo con imagen: manual + asset descargado y previsualizable",
    echoImg?.origin === "manual" && echoImg?.media?.fetchStatus === "available",
    JSON.stringify(echoImg?.media)
  );

  await buttonRepliesChecks();
  await agendaChecks();
  await attributionChecks();
  await originAdChecks();
  await r11BotChecks();
  await centralChecks();
  await todayChecks();
  await importChecks();
  await attentionChecks();
  await aboutChecks();
  await passwordToggleChecks();
  await healthPageChecks();

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

/* ============================================================
 * #78 — Respuestas de botón. Cuando el cliente toca un botón de respuesta
 * rápida de una plantilla, Meta manda `type: "button"`; cuando toca un botón
 * o una fila de lista de un mensaje interactivo, `type: "interactive"`. La
 * ingesta los descartaba: ni bandeja, ni ventana de 24 h, ni agente. Ahora
 * entran como texto con el rótulo del botón, igual que si lo hubiera
 * tecleado. Los payloads del mock tienen la forma documentada por Meta.
 * ========================================================================== */
async function buttonRepliesChecks() {
  console.log("\n== #78: una respuesta de botón entra como texto del cliente ==");
  // Contacto nuevo por corrida: la sección cuenta entrantes y espera la
  // respuesta del agente a ESTE botón, no a los de una corrida anterior.
  const RUN_VALUE = Date.now().toString().slice(-6);
  const LEAD_B = `5215550${RUN_VALUE}`;
  const TEL_B = `525550${RUN_VALUE}`;

  const profileBefore = (await api("/api/agent/profile")).json?.profile?.enabled;
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });

  const inboundValue = (extra, n) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: LEAD_B,
        name: "Lead botones",
        waMessageId: `wamid.e2e.78.${RUN_VALUE}.${n}`,
        ...extra,
      }),
    });
  const conversation = async () =>
    ((await api("/api/conversations")).json?.conversations ?? []).find(
      (c) => c.contact.phone === TEL_B
    ) ?? null;
  const messagesOf = async (convId) =>
    (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];
  const theInbound = async (convId) =>
    (await messagesOf(convId)).filter((m) => m.direction === "in");

  // 1) Botón de respuesta rápida de una plantilla.
  const sending = await inboundValue(
    { type: "button", button: { text: "Sí, me interesa", payload: "SI_INTERESA" } },
    1
  );
  ok("el webhook acepta un `type: \"button\"`", sending.res.ok, JSON.stringify(sending.json));
  let conv = null;
  await until(async () => {
    conv = await conversation();
    return !!conv;
  });
  ok("el botón de plantilla crea la conversación en la bandeja", !!conv);
  if (conv) {
    const button = (await theInbound(conv.id)).find((m) => m.text === "Sí, me interesa");
    ok(
      "y queda como texto con el rótulo del botón (type=text, no button)",
      button?.type === "text",
      JSON.stringify((await messagesOf(conv.id)).map((m) => [m.direction, m.type, m.text]))
    );
    // La conversación se releyó: la de arriba se tomó en cuanto apareció, y la
    // ingesta la crea ANTES de guardar el mensaje y anotarle la hora. Leída en
    // ese hueco, la ventana salía cerrada sin que el producto fallara.
    conv = (await conversation()) ?? conv;
    ok(
      "abre la ventana de 24 h",
      conv.windowOpen === true && !!conv.lastInboundAt,
      JSON.stringify({ windowOpen: conv.windowOpen, lastInboundAt: conv.lastInboundAt })
    );
    const answered = await until(
      async () =>
        (await messagesOf(conv.id)).some(
          (m) =>
            m.direction === "out" &&
            m.aiGenerated === true &&
            (m.text ?? "").includes("Sí, me interesa")
        ),
      20000
    );
    ok(
      "y dispara al agente como cualquier texto (contestó por el ai-mock)",
      answered,
      JSON.stringify((await messagesOf(conv.id)).map((m) => [m.direction, m.text]))
    );

    // 2) Botón de un mensaje interactivo.
    await inboundValue(
      {
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "cancel-button", title: "Cancelar" },
        },
      },
      2
    );
    const hasCancel = await until(async () =>
      (await theInbound(conv.id)).some((m) => m.type === "text" && m.text === "Cancelar")
    );
    ok("un button_reply interactivo entra como texto con su título", hasCancel);

    // 3) Fila de una lista.
    await inboundValue(
      {
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: {
            id: "priority_express",
            title: "Envío exprés",
            description: "Llega mañana",
          },
        },
      },
      3
    );
    const hasList = await until(async () =>
      (await theInbound(conv.id)).some((m) => m.type === "text" && m.text === "Envío exprés")
    );
    ok("un list_reply entra como texto con el título de la fila (no la descripción)", hasList);

    // Camino infeliz: respuesta sin rótulo ni id → se descarta con aviso y
    // el webhook sigue vivo; el hilo no gana un mensaje vacío.
    const isBroken = await inboundValue(
      { type: "interactive", interactive: { type: "button_reply", button_reply: {} } },
      4
    );
    ok("una respuesta de botón sin rótulo no tumba el webhook", isBroken.res.ok);
    await sleep(800);
    const n = (await theInbound(conv.id)).length;
    ok("y no deja un mensaje vacío en el hilo", n === 3, `entrantes=${n}`);
  }

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: profileBefore === true }),
  });
}

/* ============================================================
 * «Quién responde a tus clientes» (tests/e2e/us-bot-api.md, pasos 40-44)
 *
 * El agente incluido y un cerebro externo (Nea) no se ven entre sí: con los
 * dos activos, el cliente recibe dos respuestas. La tarjeta del Agente lo
 * dice con dos señales: la última llamada autenticada a /api/bot/* (en
 * memoria) y el /health de Nea si hay BRAIN_HEALTH_URL. Aquí se levanta una
 * Nea FALSA en el puerto de esa URL (tiene que ser local) — la app ya corre
 * con ella en su .env — y se la pone sana y después colgada.
 * ============================================================ */

/** Una Nea de mentira: responde su /health como la Nea de verdad. */
async function startFakeNea(url) {
  const { createServer } = await import("node:http");
  const status = { mode: "sana", requests: 0, lastAuth: null, lastRoute: null };
  const server = createServer((req, res) => {
    if ((req.url ?? "").split("?")[0] !== url.pathname) {
      res.writeHead(404);
      return res.end();
    }
    status.requests++;
    status.lastAuth = req.headers.authorization ?? null;
    status.lastRoute = req.url;
    if (status.mode === "colgada") return; // nunca contesta
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        db: "ok",
        version: "1.0.0",
        commit: "abc1234",
        commitVerified: true,
        mode: "estándar",
        relay: { pendientes: 0, masViejoSegundos: null, ultimoErrorEn: null },
      })
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(url.port || 80), url.hostname.replace(/^\[|\]$/g, ""), resolve);
  });
  return {
    state: status,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function whoAnswersChecks(convId) {
  console.log("\n== quién responde: la tarjeta del Agente ==");
  const status = async () => (await api("/api/agent/brain-status")).json;

  const raw = process.env.BRAIN_HEALTH_URL;
  const url = raw ? new URL(raw) : null;
  const local = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url && !local) {
    console.log(`  SKIP /health: BRAIN_HEALTH_URL apunta a ${url.host}, no a esta máquina`);
  }
  // Antes de la primera consulta: así la caché de 15 s no guarda un «no está
  // en línea» de antes de que la Nea falsa existiera.
  const nea = local ? await startFakeNea(url) : null;
  const profile = (await api("/api/agent/profile")).json;
  const enabledOriginal = profile?.profile?.enabled === true;
  try {
    await whoAnswers(convId, status, url, nea);
  } finally {
    await nea?.close();
    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: enabledOriginal }),
    });
  }
}

async function whoAnswers(convId, status, url, nea) {
  const anon = await fetch(`${BASE}/api/agent/brain-status`);
  ok("brain-status sin sesión → 401", anon.status === 401);

  const before = await status();
  ok(
    "brain-status con sesión → las dos filas y el aviso",
    typeof before?.embedded?.answering === "boolean" &&
      typeof before?.external?.active === "boolean" &&
      "warning" in (before ?? {}),
    JSON.stringify(before)
  );
  ok("la llave del cerebro externo cuenta como configurada", before?.external?.keyConfigured === true);

  // La última llamada: solo la mueve una llamada AUTENTICADA.
  await sleep(1100);
  await api("/api/bot/profile", { headers: { "x-api-key": "x".repeat(BOT_KEY.length) } });
  const afterBad = await status();
  ok(
    "una llamada con key equivocada NO cuenta como «visto»",
    afterBad?.external?.lastSeenAt === before?.external?.lastSeenAt,
    `${before?.external?.lastSeenAt} → ${afterBad?.external?.lastSeenAt}`
  );
  const ctx = await bot(`/api/bot/context?conversationId=${convId}`);
  ok("GET /api/bot/context con la key → 200", ctx.res.ok);
  const after = await status();
  const tBefore = Date.parse(before?.external?.lastSeenAt ?? "") || 0;
  const tAfter = Date.parse(after?.external?.lastSeenAt ?? "") || 0;
  ok(
    "…y lastSeenAt avanza",
    tAfter > tBefore && Date.now() - tAfter < 30_000,
    `${before?.external?.lastSeenAt} → ${after?.external?.lastSeenAt}`
  );
  ok("…y el cerebro externo cuenta como activo", after?.external?.active === true);

  if (!url) {
    ok("sin BRAIN_HEALTH_URL no se le pregunta a nadie (health: null)", after?.external?.health === null);
    console.log(
      "  (para probar el /health: BRAIN_HEALTH_URL=http://127.0.0.1:<puerto>/health en .env y reinicia la app)"
    );
  }

  if (nea) {
    // Una corrida anterior pudo dejar en caché a su Nea colgada (15 s).
    let h = null;
    const enLinea = await until(async () => {
      h = (await status())?.external?.health ?? null;
      return h?.reachable === true;
    }, 25_000, 1000);
    ok("con la Nea falsa sana: en línea", enLinea, JSON.stringify(h));
    ok(
      "…con versión, modo y cola del relevo",
      h?.version === "1.0.0" && h?.mode === "estándar" && h?.relay?.pendientes === 0,
      JSON.stringify(h)
    );
    ok("…y solo el host de la URL", h?.host === url.host, h?.host);
    const dump = JSON.stringify(await status());
    const secrets = [url.username, url.password, url.search.slice(1)].filter(Boolean);
    ok(
      "credenciales y query de BRAIN_HEALTH_URL no salen en la respuesta",
      secrets.every((s) => !dump.includes(decodeURIComponent(s))),
      `revisados ${secrets.length}`
    );
    if (url.username || url.password) {
      ok(
        "…pero sí viajan a Nea (Authorization: Basic)",
        nea.state.lastAuth ===
          `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`
      );
    }
    const requestsBefore = nea.state.requests;
    await Promise.all([status(), status(), status()]);
    ok(
      "tres consultas seguidas no martillan a Nea (caché)",
      nea.state.requests === requestsBefore,
      `${requestsBefore} → ${nea.state.requests}`
    );
  }

  // Los dos contestando: el aviso rojo.
  const on = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  ok("agente incluido encendido desde la pantalla", on.res.ok);
  const double = await status();
  ok(
    "con token de IA + agente encendido + cerebro externo activo → doble_respuesta",
    double?.embedded?.configured === true &&
      double?.embedded?.answering === true &&
      double?.warning === "doble_respuesta",
    JSON.stringify({ embedded: double?.embedded, warning: double?.warning })
  );
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: false }),
  });
  const solo = await status();
  ok(
    "apagar el agente incluido quita el aviso (contesta solo el externo)",
    solo?.embedded?.answering === false && solo?.warning === null,
    JSON.stringify({ embedded: solo?.embedded, warning: solo?.warning })
  );

  if (nea) {
    // Nea colgada: la tarjeta se entera sin quedarse esperando.
    nea.state.mode = "colgada";
    let h = null;
    let slower = 0;
    const down = await until(async () => {
      const t0 = Date.now();
      h = (await status())?.external?.health ?? null;
      slower = Math.max(slower, Date.now() - t0);
      return h?.reachable === false;
    }, 25_000, 1000);
    ok(
      "con Nea colgada: no está en línea, por tiempo agotado",
      down && h?.problem === "timeout",
      JSON.stringify(h)
    );
    ok(
      "…y la consulta no se cuelga con ella (≤ 4 s)",
      slower <= 4000,
      `${slower} ms`
    );
    const continues = await status();
    ok(
      "…la llamada reciente la sigue contando como activa",
      continues?.external?.active === true,
      JSON.stringify(continues?.external)
    );
  }
}

/* ============================================================
 * Guía de inicio — la primera pantalla (tests/e2e/us-onboarding-guide.md, #86)
 *
 * Lo que se protege: que la raíz mande a la guía mientras falte un paso o el
 * agente siga apagado, que cada paso se marque solo cuando la pieza de verdad
 * funciona (la misma fuente que usa el resto de la app), y que «Encender»
 * saque la guía del camino. Corre justo después del login, antes de que el
 * resto del guion conecte nada: así se ve la instancia como la ve quien
 * acaba de instalar. En una RE-CORRIDA la base ya trae de todo, así que
 * primero se vuelve al punto de partida (sin llave, sin número, agente sin
 * instrucciones y apagado) y al final se deja como estaba para lo que sigue.
 * ============================================================ */

async function guideChecks() {
  console.log("\n== guía de inicio: la primera pantalla ==");
  const agenda = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
  // La app lee el mismo .env que este guion: si trae la llave, el paso 2 ya
  // está listo «por el respaldo del entorno» y la guía lo dice así.
  const fallbackEnv = Boolean((process.env.OPENROUTER_API_TOKEN ?? "").trim());

  const status = async () => (await api("/api/onboarding/status")).json;
  const step = async (key) => (await status())?.steps?.find((s) => s.key === key);
  /** A dónde manda la raíz con la sesión del operador. */
  const root = async () => {
    const res = await fetch(`${BASE}/`, { redirect: "manual", headers: { cookie } });
    const loc = res.headers.get("location") ?? "";
    return `${res.status} ${loc}`;
  };
  const sendsTo = (destination) => (r) =>
    /^30[0-9] /.test(r) && (r.endsWith(destination) || r.endsWith(`${destination}/`));
  // React separa las expresiones JSX con `<!-- -->` en el HTML del servidor:
  // «Deja listo tu CRM en <!-- -->4<!-- --> pasos». Se compara el texto.
  const text = (h) => h.replace(/<!--.*?-->/g, "");

  // --- Punto de partida reproducible ---
  await api("/api/settings/ai", { method: "DELETE" });
  await api("/api/settings/whatsapp", { method: "DELETE" });
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: false, instructions: null }),
  });
  for (const e of (await api("/api/kb")).json?.entries ?? []) {
    await api(`/api/kb/${e.id}`, { method: "DELETE" });
  }
  if (agenda) {
    // Todos los días cerrados: el paso 4 queda pendiente aunque una corrida
    // anterior ya hubiera guardado horarios.
    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ connector: "enlace-fijo", weeklyHours: {} }),
    });
  }

  // --- Lo que ve quien acaba de instalar ---
  const anon = await fetch(`${BASE}/api/onboarding/status`);
  ok("estado sin sesión → 401", anon.status === 401, `status=${anon.status}`);

  const initial = await status();
  ok(
    "GET /api/onboarding/status → pasos verificados + guía + agente apagado",
    Array.isArray(initial?.steps) && initial?.enabled === false && initial?.guide?.complete === false,
    JSON.stringify(initial)
  );
  ok(
    "los pasos de la raíz: agente, IA, WhatsApp y agenda",
    JSON.stringify(initial?.steps?.map((s) => s.key)) ===
      JSON.stringify(["profile", "ai", "whatsapp", "calendar"]),
    JSON.stringify(initial?.steps?.map((s) => s.key))
  );
  const guideKeys = initial?.guide?.steps?.map((s) => s.key) ?? [];
  ok(
    agenda
      ? "con la agenda encendida la guía tiene 4 pasos"
      : "sin agenda la guía tiene 3 pasos (el de agenda ni se pinta)",
    JSON.stringify(guideKeys) ===
      JSON.stringify(agenda ? ["agent", "ai", "whatsapp", "calendar"] : ["agent", "ai", "whatsapp"]),
    JSON.stringify(guideKeys)
  );
  const perfil0 = initial?.steps?.find((s) => s.key === "profile");
  ok(
    "el agente con nombre de fábrica y sin instrucciones está pendiente y dice qué falta",
    perfil0?.status === "pending" && /nombre/.test(perfil0?.nextAction ?? ""),
    JSON.stringify(perfil0)
  );
  ok(
    "WhatsApp sin número → pendiente",
    initial?.steps?.find((s) => s.key === "whatsapp")?.status === "pending"
  );
  const ia0 = initial?.steps?.find((s) => s.key === "ai");
  ok(
    fallbackEnv
      ? "IA: sin fila guardada cuenta el respaldo del entorno (OPENROUTER_*)"
      : "IA: sin fila ni entorno → pendiente",
    fallbackEnv
      ? ia0?.status === "ready" && /entorno/.test(ia0?.nextAction ?? "")
      : ia0?.status === "pending",
    JSON.stringify(ia0)
  );

  const r0 = await root();
  ok("la raíz manda a /onboarding mientras falte un paso", sendsTo("/onboarding")(r0), r0);

  // La pantalla se compila en su primer request en `next dev`: espera activa.
  let html = "";
  const screen = await until(async () => {
    const res = await fetch(`${BASE}/onboarding`, { headers: { cookie } });
    html = res.ok ? text(await res.text()) : "";
    return res.ok && html.includes("Deja listo tu CRM en");
  }, 40_000, 1000);
  ok("la pantalla /onboarding carga con la cabecera «Deja listo tu CRM en N pasos»", screen);
  ok(
    `…y cuenta los ${guideKeys.length} pasos de esta instancia`,
    html.includes(`Deja listo tu CRM en ${guideKeys.length} pasos`)
  );
  ok(
    "…con la tarjeta final explicando que el agente empieza apagado",
    html.includes("Al final: encender a") && html.includes("empieza apagado")
  );
  ok("…y la entrada «Guía de inicio» en el menú", html.includes("Guía de inicio"));

  // --- Los pasos se marcan solos ---
  const profileOk = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ name: "Sofi", instructions: "Vendemos limpiezas dentales." }),
  });
  ok(
    "paso 1: guardar nombre + instrucciones lo deja listo",
    profileOk.res.ok && (await step("profile"))?.status === "ready"
  );

  const saveIa = await api("/api/settings/ai", {
    method: "PUT",
    body: JSON.stringify({
      provider: "openai_compatible",
      baseUrl: process.env.OPENROUTER_BASE_URL ?? `${BASE}/api/dev/ai-mock`,
      model: "mock/modelo-e2e",
      token: "tok-ia-e2e-0001",
    }),
  });
  const aiRow = await step("ai");
  ok(
    "paso 2: la llave guardada en Ajustes → IA lo deja listo (la fila manda)",
    saveIa.res.ok && aiRow?.status === "ready" && /Ajustes/.test(aiRow?.nextAction ?? ""),
    `status=${saveIa.res.status} ${JSON.stringify(aiRow)}`
  );

  const connect = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok(
    "paso 3: conectar el número lo deja listo",
    connect.res.ok && (await step("whatsapp"))?.status === "ready",
    `status=${connect.res.status}`
  );

  if (agenda) {
    const closed = await step("calendar");
    ok(
      "paso 4: con todos los días cerrados la agenda sigue pendiente",
      closed?.status === "pending" && closed?.href === "/settings/calendar",
      JSON.stringify(closed)
    );
    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({
        connector: "zoom",
        weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] },
      }),
    });
    const zoomWithoutCred = await step("calendar");
    ok(
      "paso 4: Zoom elegido sin credencial → pendiente, y la pista lo dice",
      zoomWithoutCred?.status === "pending" && /Zoom/.test(zoomWithoutCred?.problem ?? ""),
      JSON.stringify(zoomWithoutCred)
    );
    const schedule = await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({
        connector: "enlace-fijo",
        weeklyHours: {
          mon: [{ start: "09:00", end: "18:00" }],
          tue: [{ start: "09:00", end: "18:00" }],
          wed: [{ start: "09:00", end: "18:00" }],
          thu: [{ start: "09:00", end: "18:00" }],
          fri: [{ start: "09:00", end: "18:00" }],
        },
      }),
    });
    ok(
      "paso 4: horarios + enlace fijo lo deja listo sin credenciales de nadie",
      schedule.res.ok && (await step("calendar"))?.status === "ready"
    );
  } else {
    const notApplicable = await step("calendar");
    ok(
      "sin agenda el paso se reporta «no aplica» y sin enlace",
      notApplicable?.status === "not_applicable" && notApplicable?.href === null,
      JSON.stringify(notApplicable)
    );
  }

  // --- Encender ---
  const ready = await status();
  ok(
    "con todo listo: guía completa y agente todavía apagado",
    ready?.guide?.complete === true && ready?.enabled === false,
    JSON.stringify(ready?.guide)
  );
  const r1 = await root();
  ok("…y la raíz SIGUE mandando a /onboarding: falta encenderlo", sendsTo("/onboarding")(r1), r1);
  const htmlReady = text(await (await fetch(`${BASE}/onboarding`, { headers: { cookie } })).text());
  ok(
    "la tarjeta final ofrece «Encender a Sofi» (el nombre, ya configurado)",
    htmlReady.includes("Enciende a Sofi") && htmlReady.includes("Encender a Sofi")
  );

  const turnOn = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  ok("Encender → PUT /api/agent/profile {enabled:true}", turnOn.res.ok);
  const isOn = await status();
  ok("…y la guía lo refleja", isOn?.enabled === true && isOn?.guide?.enabled === true);
  const r2 = await root();
  ok("con todo listo y encendido la raíz manda a la Bandeja", sendsTo("/inbox")(r2), r2);
  const htmlOn = text(await (await fetch(`${BASE}/onboarding`, { headers: { cookie } })).text());
  ok(
    "la guía sigue disponible y dice que Sofi ya está contestando",
    htmlOn.includes("Sofi ya está contestando") && htmlOn.includes("Ir a la Bandeja")
  );

  // --- Como estaba, para lo que sigue ---
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  // Sin la fila, el resto del guion sigue hablando con el ai-mock por el
  // respaldo del entorno, como antes de esta sección.
  await api("/api/settings/ai", { method: "DELETE" });
}

/* ============================================================
 * us5 — Guardar la conexión registra el webhook en Meta y respeta el
 * override de un cerebro externo (tests/e2e/us5-connect.md, pasos 3, 4, 4b,
 * 7 y 8)
 *
 * Antes, guardar dejaba al operador a medias: el token era válido y se podía
 * enviar, pero no llegaba nada hasta que alguien pegaba la URL en el panel de
 * su app de Meta. Ahora el CRM la registra él mismo, como override del
 * NÚMERO, y «Meta» (el wa-mock) hace el handshake de verdad contra la ruta.
 *
 * Y lo de siempre: en Meta, `POST {WABA}/subscribed_apps` SIN cuerpo es la
 * forma documentada de BORRAR el override de callback de la WABA, y el CRM lo
 * mandaba en cada "Guardar": un cerebro externo (Nea) que recibe los webhooks
 * por ese override quedaba sordo sin que nada lo avisara. El override del
 * número ganaría igual, así que con uno ajeno en la WABA el CRM no lo pone.
 * El wa-mock se comporta como Meta, así que si el CRM vuelve a pisar a
 * ciegas, esto se pone rojo.
 * ============================================================ */

async function overrideChecks() {
  console.log("\n== us5: guardar registra el webhook y no desconecta a un cerebro externo ==");
  const WABA = "WABA-E2E";
  const NEA = "https://nea.e2e.test/api/webhooks/meta";
  const graph = `/api/dev/wa-mock/graph/v25.0/${WABA}/subscribed_apps`;
  const asMeta = { authorization: "Bearer tok-e2e" };

  const subscription = async () =>
    (await api(graph, { headers: asMeta })).json?.data ?? [];
  const overrideActual = async () =>
    (await subscription()).find((app) => app.override_callback_uri)
      ?.override_callback_uri ?? null;
  /** El override que «Meta» tiene en el NÚMERO (lo que el CRM registra). */
  const numberWebhook = async () =>
    (await api("/api/dev/wa-mock/webhooks")).json?.phoneWebhooks?.[PN] ?? null;
  const save = (token) =>
    api("/api/settings/whatsapp", {
      method: "PUT",
      body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token }),
    });
  const ownUrl = (await api("/api/settings/webhook")).json?.url ?? null;

  // Modo directo: sin override, guardar suscribe la app, como siempre…
  let saved = await save("tok-e2e");
  const afterSave = await subscription();
  ok(
    "sin override, guardar la conexión suscribe la app a la WABA",
    saved.res.ok &&
      afterSave.length === 1 &&
      !afterSave[0]?.override_callback_uri,
    JSON.stringify({ status: saved.res.status, afterSave: afterSave })
  );
  // …y registra el webhook de la instancia en el número (pasó el handshake).
  ok(
    "y registra el webhook de la instancia en el NÚMERO (handshake incluido)",
    saved.json?.webhook?.ok === true &&
      saved.json.webhook.appWithoutWebhook === false &&
      !!ownUrl &&
      (await numberWebhook()) === ownUrl,
    JSON.stringify({ webhook: saved.json?.webhook, ownUrl: ownUrl, enMeta: await numberWebhook() })
  );

  // El botón «Registrar en Meta» lo repite con la conexión guardada.
  const button = await api("/api/settings/webhook", { method: "POST" });
  ok(
    "«Registrar en Meta» repite el registro sin volver a pegar el token",
    button.res.ok && button.json?.ok === true && (await numberWebhook()) === ownUrl,
    JSON.stringify(button.json)
  );

  // Un token sin whatsapp_business_management: Meta rechaza el registro, la
  // conexión se guarda igual y el motivo viaja en la respuesta.
  const withoutHandling = await save("tok-e2e-sin-gestion");
  ok(
    "sin permiso de gestión, la conexión se guarda (200) y avisa por qué no registró",
    withoutHandling.res.ok &&
      withoutHandling.json?.webhook?.ok === false &&
      withoutHandling.json.webhook.code === "missing_permission",
    JSON.stringify({ status: withoutHandling.res.status, webhook: withoutHandling.json?.webhook })
  );
  const unhandledButton = await api("/api/settings/webhook", { method: "POST" });
  ok(
    "y el botón devuelve el mismo motivo con 422",
    unhandledButton.res.status === 422 &&
      unhandledButton.json?.error?.code === "missing_permission",
    JSON.stringify(unhandledButton.json)
  );
  await save("tok-e2e");

  // El cerebro externo fija SU override contra Meta (lo que hace Nea).
  const pinned = await api(graph, {
    method: "POST",
    headers: asMeta,
    body: JSON.stringify({
      override_callback_uri: NEA,
      verify_token: "verify-e2e",
    }),
  });
  ok(
    "el cerebro externo fija su override en la WABA",
    pinned.res.ok && (await overrideActual()) === NEA
  );

  // Rotar el token y guardar otra vez — el caso que lo desconectaba.
  saved = await save("tok-e2e-rotado");
  ok(
    "guardar la conexión con el token rotado responde 200",
    saved.res.ok,
    JSON.stringify(saved.json)
  );
  const after = await overrideActual();
  ok(
    "y el override del cerebro externo SIGUE en la WABA",
    after === NEA,
    `override=${after}`
  );
  // El override del número gana al de la WABA: con uno ajeno, el CRM no pone
  // el suyo y quita el que había dejado el guardado anterior.
  ok(
    "y el número queda SIN override propio: el cerebro externo sigue recibiendo",
    saved.json?.webhook?.skipped === "waba_override" &&
      saved.json.webhook.host === "nea.e2e.test" &&
      (await numberWebhook()) === null,
    JSON.stringify({ webhook: saved.json?.webhook, enMeta: await numberWebhook() })
  );

  // Control del propio mock: un POST sin cuerpo SÍ borra el override, como en
  // Meta. Sin esto, el check anterior podría pasar contra un mock permisivo.
  await api(graph, { method: "POST", headers: asMeta });
  ok(
    "control: un POST sin cuerpo borra el override (así se comporta Meta)",
    (await overrideActual()) === null
  );

  // Desconectar: quita el override del número en Meta ANTES de soltar el
  // token, y la bandeja no se toca. Luego el guion sigue con la conexión de
  // siempre.
  await save("tok-e2e");
  const beforeReleasing = await numberWebhook();
  const release = await api("/api/settings/whatsapp", { method: "DELETE" });
  const withoutConnection = (await api("/api/settings/whatsapp")).json?.connection;
  ok(
    "desconectar borra la conexión y quita el override del número en Meta",
    release.res.ok &&
      beforeReleasing === ownUrl &&
      withoutConnection === null &&
      (await numberWebhook()) === null,
    JSON.stringify({ status: release.res.status, beforeRelease: beforeReleasing, withoutConnection: withoutConnection, enMeta: await numberWebhook() })
  );
  const reconnected = await save("tok-e2e");
  ok(
    "y volver a guardar lo deja registrado otra vez",
    reconnected.res.ok && (await numberWebhook()) === ownUrl,
    JSON.stringify(reconnected.json)
  );
}

/* ============================================================
 * 015 — Motor de agenda universal (tests/e2e/us-agenda.md)
 *
 * Cubre las dos configuraciones de la bandera, las dos garantías
 * innegociables con sus CÓDIGOS EXACTOS, la carrera del hueco, el enlace
 * pendiente cuando el proveedor falla, y el sandbox del Laboratorio.
 * ============================================================ */

async function agendaChecks() {
  const onValue = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.AGENDA ?? "").trim()
  );

  console.log("\n== 015: la bandera de la agenda ==");
  const routes = [
    "/api/calendar/settings",
    "/api/calendar/availability",
    "/api/bookings",
  ];

  if (!onValue) {
    // Con la bandera apagada la agenda NO EXISTE: ni rutas de operador, ni de
    // servicio, ni pantallas. Es la mitad del contrato que casi nunca se
    // prueba, y la que toda instancia normal usa.
    for (const route of routes) {
      const { res } = await api(route);
      ok(`${route} → 404 con la agenda apagada`, res.status === 404, `status=${res.status}`);
    }
    const botAvail = await bot("/api/bot/availability?conversationId=x");
    ok(
      "/api/bot/availability → 404 con la agenda apagada",
      botAvail.res.status === 404,
      `status=${botAvail.res.status}`
    );
    const page = await fetch(`${BASE}/bookings`, { headers: { cookie } });
    ok("la pantalla /bookings no existe", page.status === 404, `status=${page.status}`);
    console.log("  (agenda apagada: el resto de los checks de 015 no aplican)");
    return;
  }

  for (const route of routes) {
    const { res } = await api(route);
    ok(`${route} responde con la agenda encendida`, res.ok, `status=${res.status}`);
  }

  console.log("\n== 015: configuración de la agenda (US2) ==");
  const defaults = (await api("/api/calendar/settings")).json?.settings;
  ok(
    "una instancia sin configurar da defaults usables, no 404",
    defaults?.slotMinutes === 30 && defaults?.connector === "enlace-fijo",
    JSON.stringify(defaults)
  );

  const ROOM = "https://meet.ejemplo.test/sala-fija";
  const saved = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({
      weeklyHours: {
        mon: [{ start: "09:00", end: "18:00" }],
        tue: [{ start: "09:00", end: "18:00" }],
        wed: [{ start: "09:00", end: "18:00" }],
        thu: [{ start: "09:00", end: "18:00" }],
        fri: [{ start: "09:00", end: "18:00" }],
        sat: [{ start: "09:00", end: "18:00" }],
        sun: [{ start: "09:00", end: "18:00" }],
      },
      slotMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 7,
      connector: "enlace-fijo",
      meetingLink: ROOM,
    }),
  });
  ok("se guarda el horario y la sala fija", saved.res.ok, `status=${saved.res.status}`);

  const badTz = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ timezone: "Marte/Olympus" }),
  });
  ok(
    "una zona horaria inventada se rechaza (422) en vez de romper el motor",
    badTz.res.status === 422,
    `status=${badTz.res.status}`
  );

  const disp = (await api("/api/calendar/availability")).json?.slots ?? [];
  ok("hay huecos ofrecibles tras configurar", disp.length > 0, `slots=${disp.length}`);
  ok(
    "cada hueco trae el día EN PALABRAS, no solo la hora",
    Boolean(disp[0]?.dayLabel && disp[0]?.time),
    JSON.stringify(disp[0])
  );

  console.log("\n== 015: las dos garantías (US3) ==");
  const LEAD_A = "5214627015001";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD_A,
      name: "Lead agenda A",
      text: "quiero agendar",
      waMessageId: "wamid.e2e.015.a.1",
    }),
  });
  const LEAD_B = "5214627015002";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD_B,
      name: "Lead agenda B",
      text: "yo también quiero",
      waMessageId: "wamid.e2e.015.b.1",
    }),
  });
  await sleep(1500);

  const convsAgenda = (await api("/api/conversations")).json?.conversations ?? [];
  const convA = convsAgenda.find((c) => c.contact.phone === "524627015001");
  const convB = convsAgenda.find((c) => c.contact.phone === "524627015002");
  ok("dos conversaciones de prueba listas", Boolean(convA && convB));
  if (!convA || !convB) return;

  const offerA = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const slotsA = offerA.json?.slots ?? [];
  ok("ofrecer horarios devuelve huecos", slotsA.length > 0, `slots=${slotsA.length}`);
  ok(
    "el reparto cubre más de un día (no todo hoy)",
    (offerA.json?.diasConAgenda ?? []).length > 1,
    JSON.stringify(offerA.json?.diasConAgenda)
  );

  // GARANTÍA 1: un instante libre pero JAMÁS ofrecido se rechaza.
  const notOffered = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({
      conversationId: convA.id,
      // Un minuto después de un hueco real: válido, libre, y nunca ofrecido.
      startUtc: new Date(Date.parse(slotsA[0].startUtc) + 60_000).toISOString(),
    }),
  });
  ok(
    "horario no ofrecido → 409 slot_not_offered (código EXACTO)",
    notOffered.res.status === 409 &&
      notOffered.json?.error?.code === "slot_not_offered",
    `status=${notOffered.res.status} body=${JSON.stringify(notOffered.json)}`
  );
  ok(
    "y devuelve lo que SÍ se ofreció, para re-ofrecer sin inventar",
    (notOffered.json?.slots ?? []).length > 0
  );

  // Camino feliz: 201 EXACTO, no 200.
  const chosen = slotsA[0].startUtc;
  const createdValue = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({ conversationId: convA.id, startUtc: chosen }),
  });
  ok(
    "reservar responde 201 Created (NO 200): es contrato",
    createdValue.res.status === 201,
    `status=${createdValue.res.status}`
  );
  ok(
    "la respuesta trae etiqueta y el enlace de la sala fija",
    createdValue.json?.label && createdValue.json?.meetingLink === ROOM,
    JSON.stringify(createdValue.json)
  );
  ok("el enlace no queda pendiente con el conector soberano", createdValue.json?.linkPending === false);

  const availabilityAfterBooking = (await api("/api/calendar/availability")).json?.slots ?? [];
  ok(
    "el hueco reservado desaparece de la disponibilidad",
    !availabilityAfterBooking.some((s) => s.startUtc === chosen)
  );

  const list = (await api("/api/bookings")).json?.bookings ?? [];
  ok(
    "la cita aparece en Citas, marcada como agendada por la IA",
    list.some((b) => b.id === createdValue.json?.bookingId && b.source === "ai"),
    JSON.stringify(list.map((b) => ({ id: b.id, source: b.source })))
  );

  /**
   * El contexto del cerebro SABE de la cita.
   *
   * Sin esto un cerebro externo solo conoce la cita por el historial, y en la
   * edición cloud eso acabó en una segunda cita para quien no llegó a la
   * primera y en «tu demo es hoy a las 10:30» dicho por la tarde. Nea lee este
   * bloque tal cual; la raíz no lo mandaba.
   */
  const ctxWithBooking = await bot(`/api/bot/context?conversationId=${convA.id}`);
  const next = ctxWithBooking.json?.booking?.next;
  ok(
    "el contexto del cerebro trae la cita que viene: id, instante UTC y estado",
    next?.id === createdValue.json?.bookingId &&
      next?.startUtc === chosen &&
      next?.status === "agendada" &&
      next?.endUtc === new Date(Date.parse(chosen) + 30 * 60_000).toISOString(),
    JSON.stringify(ctxWithBooking.json?.booking)
  );
  ok(
    "…con la etiqueta del día en palabras, en la zona del negocio",
    ctxWithBooking.json?.booking?.timezone === "America/Lima" &&
      typeof next?.label === "string" &&
      next.label.endsWith(`, ${slotsA[0].time}`) &&
      next.label.length > `, ${slotsA[0].time}`.length + 8,
    `label=${JSON.stringify(next?.label)} time=${slotsA[0].time}`
  );
  ok(
    "…y con el enlace que se le dio al cliente",
    next?.meetingLink === ROOM && next?.linkPending === false,
    JSON.stringify({ meetingLink: next?.meetingLink, linkPending: next?.linkPending })
  );

  // GARANTÍA 2: la carrera. B tenía el mismo hueco ofrecido y llega tarde.
  const offerB = await bot(
    `/api/bot/availability?conversationId=${convB.id}&limit=12&perDay=3&days=5`
  );
  // Se le ofrece a B exactamente el hueco que A acaba de tomar: se simula la
  // oferta previa a la reserva de A, que es como ocurre en la vida real.
  const taken = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({ conversationId: convB.id, startUtc: chosen }),
  });
  ok(
    "el hueco ya tomado → 409 (nunca una segunda cita)",
    taken.res.status === 409,
    `status=${taken.res.status} body=${JSON.stringify(taken.json)}`
  );
  ok(
    "el sobre del error va ANIDADO y `slots` es HERMANO",
    typeof taken.json?.error?.code === "string" && Array.isArray(taken.json?.slots),
    JSON.stringify(taken.json)
  );

  const listAfterRace = (await api("/api/bookings")).json?.bookings ?? [];
  const activeInSlot = listAfterRace.filter(
    (b) =>
      b.scheduledAtUtc === chosen &&
      (b.status === "agendada" || b.status === "realizada")
  );
  ok(
    "CERO doble-agendamiento: una sola cita activa en ese instante",
    activeInSlot.length === 1,
    `activas=${activeInSlot.length}`
  );

  // Las alternativas del 409 ya son la oferta vigente: reservables de una.
  const alternative = (taken.json?.slots ?? [])[0];
  if (alternative) {
    const withAlternative = await bot("/api/bot/bookings", {
      method: "POST",
      body: JSON.stringify({
        conversationId: convB.id,
        startUtc: alternative.startUtc,
      }),
    });
    ok(
      "una alternativa del 409 se reserva de inmediato (201)",
      withAlternative.res.status === 201,
      `status=${withAlternative.res.status}`
    );
  } else {
    ok("el 409 trajo alternativas frescas", false, "lista vacía");
  }

  // Reprogramar por la superficie del bot: 200, no 201.
  const offerMove = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const destination = (offerMove.json?.slots ?? [])[0];
  if (destination) {
    const moved = await bot("/api/bot/bookings", {
      method: "PATCH",
      body: JSON.stringify({
        conversationId: convA.id,
        startUtc: destination.startUtc,
      }),
    });
    ok(
      "reprogramar responde 200 (NO 201): no crea un recurso nuevo",
      moved.res.status === 200,
      `status=${moved.res.status}`
    );
    const ctxMoved = (await bot(`/api/bot/context?conversationId=${convA.id}`)).json
      ?.booking?.next;
    ok(
      "el contexto sigue a la cita movida: la MISMA cita, en su instante nuevo",
      ctxMoved?.id === createdValue.json?.bookingId && ctxMoved?.startUtc === destination.startUtc,
      JSON.stringify(ctxMoved)
    );
  }

  /**
   * El agujero de INTEGRACIÓN del issue #50.
   *
   * Todo lo de arriba entra por `/api/bot/*`, donde quien llama YA tiene el
   * ISO. El agente EMBEBIDO no lo tenía: al modelo solo le llegaban el prompt
   * y el historial de TEXTO, con las etiquetas que leyó el cliente y sin año,
   * zona ni fecha de hoy. Acertar el instante era suerte, el rechazo caía en
   * `slot_not_offered` —de texto fijo— y la conversación repetía la lista
   * para siempre.
   *
   * Y por eso este self-test no lo cazaba: el resto de 015 ejercita el
   * gateway, nunca la conversación. Aquí hay que ENCENDER el agente
   * in-process a propósito, y apagarlo después para no alterar lo que sigue.
   */
  console.log("\n== 015: el agente reserva desde la conversación (#50) ==");
  {
    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    const isOn = await api("/api/agent/profile");
    ok(
      "el agente in-process queda encendido para esta prueba",
      isOn.json?.profile?.enabled === true,
      JSON.stringify(isOn.json?.profile?.enabled)
    );

    /**
     * Contacto NUEVO en cada corrida.
     *
     * Con un teléfono fijo, la segunda ejecución arrastra la conversación y —
     * sobre todo— las OFERTAS de la anterior: el mapa ya está ahí desde el
     * primer mensaje y el agente reserva antes de ofrecer, así que el check
     * mide otra cosa. El resto del guion asume base recién sembrada; esta
     * sección no puede permitírselo porque compara ANTES y DESPUÉS.
     */
    const RUN_VALUE = Date.now().toString().slice(-6);
    const LEAD_C = `5214627${RUN_VALUE}`;
    const say = (text, n) =>
      api("/api/dev/wa-mock/inbound", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: PN,
          from: LEAD_C,
          name: "Lead agenda C",
          text: text,
          // Único por corrida: con un id fijo, la segunda ejecución lo
          // deduplica en la ingesta y no entra NADA — el agente no llega a
          // correr y el check falla sin que haya nada roto.
          waMessageId: `wamid.e2e.015.c.${RUN_VALUE}.${n}`,
        }),
      });

    await say("quiero agendar una cita", 1);
    await until(async () => {
      const cs = (await api("/api/conversations")).json?.conversations ?? [];
      return cs.some((c) => c.contact.phone === `524627${RUN_VALUE}`);
    });

    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    const convC = convs.find((c) => c.contact.phone === `524627${RUN_VALUE}`);
    ok("el agente atendió al lead que pide cita", Boolean(convC));

    if (convC) {
      const outboundOf = async () => {
        const msgs =
          (await api(`/api/conversations/${convC.id}/messages`)).json
            ?.messages ?? [];
        return msgs.filter((m) => m.direction === "out");
      };

      // El agente tiene que RESPONDER; cuánto tarde no es asunto del check.
      await until(async () => (await outboundOf()).length > 0);
      const afterOffer = await outboundOf();
      ok(
        "el agente OFRECE horarios (hay respuesta, no silencio)",
        afterOffer.length > 0 && /\d{2}:\d{2}/.test(afterOffer.at(-1)?.text ?? ""),
        `salientes=${afterOffer.length} ultimo=${(afterOffer.at(-1)?.text ?? "").slice(0, 80)}`
      );

      const before = (await api("/api/bookings")).json?.bookings ?? [];
      await say("quiero el primero", 2);
      await until(async () => {
        const bs = (await api("/api/bookings")).json?.bookings ?? [];
        return bs.length > before.length;
      });

      const after = (await api("/api/bookings")).json?.bookings ?? [];
      ok(
        "elegir un horario CREA la cita (no repite la lista)",
        after.length > before.length,
        `citas antes=${before.length} despues=${after.length}`
      );

      /**
       * Aquí había una tercera comprobación —«confirma en vez de volver a
       * ofrecer»— y se quitó: pasaba TAMBIÉN con el bug puesto, porque bajo el
       * fallo el agente responde cualquier otra cosa que tampoco contiene
       * «estos horarios». Una comprobación que no distingue el fallo del
       * acierto solo da confianza falsa. Lo que decide es la cita creada.
       */
    }

    await api("/api/agent/profile", {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
  }

  console.log("\n== 015: el operador y el enlace pendiente (US4) ==");
  const bookingId = createdValue.json?.bookingId;
  const cancelada1 = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel" }),
  });
  const cancelada2 = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "cancel" }),
  });
  ok(
    "cancelar dos veces no falla (idempotente)",
    cancelada1.res.ok && cancelada2.res.ok,
    `${cancelada1.res.status}/${cancelada2.res.status}`
  );

  /**
   * Y el contexto dice que se CANCELÓ, y quién.
   *
   * En la edición cloud, sin esto, el agente le contestó a un cliente cuya
   * demo canceló el equipo «no quedó guardada, por alguna razón»: veía la
   * cita en el historial y no en el contexto, e inventó el motivo.
   */
  const ctxCancelled = (await bot(`/api/bot/context?conversationId=${convA.id}`)).json
    ?.booking;
  ok(
    "cancelada desde el panel, el contexto ya no la da por vigente",
    Boolean(ctxCancelled) && ctxCancelled.next?.id !== bookingId,
    JSON.stringify(ctxCancelled?.next)
  );
  ok(
    "…y la trae como cancelada por el equipo, sin enlace",
    ctxCancelled?.lastClosed?.id === bookingId &&
      ctxCancelled.lastClosed.status === "cancelada" &&
      ctxCancelled.lastClosed.cancelledBy === "equipo" &&
      typeof ctxCancelled.lastClosed.closedAt === "string" &&
      !("meetingLink" in ctxCancelled.lastClosed),
    JSON.stringify(ctxCancelled?.lastClosed)
  );

  const invalidRetry = await api(`/api/bookings/${bookingId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "retry_link" }),
  });
  ok(
    "reintentar el enlace de una cita que sí lo tiene → 422",
    invalidRetry.res.status === 422,
    `status=${invalidRetry.res.status}`
  );

  // El conector caído: la cita SE CREA igual, con el enlace pendiente.
  await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ connector: "zoom" }),
  });
  const offerPend = await bot(
    `/api/bot/availability?conversationId=${convA.id}&limit=12&perDay=3&days=5`
  );
  const slotPend = (offerPend.json?.slots ?? [])[0];
  if (slotPend) {
    const withoutProvider = await bot("/api/bot/bookings", {
      method: "POST",
      body: JSON.stringify({
        conversationId: convA.id,
        startUtc: slotPend.startUtc,
      }),
    });
    ok(
      "con el proveedor sin conectar, la cita SE CREA igual (201)",
      withoutProvider.res.status === 201,
      `status=${withoutProvider.res.status}`
    );
    ok(
      "…y avisa que el enlace queda pendiente, en vez de prometerlo",
      withoutProvider.json?.linkPending === true &&
        withoutProvider.json?.meetingLink === null,
      JSON.stringify(withoutProvider.json)
    );

    const listPend = (await api("/api/bookings")).json?.bookings ?? [];
    ok(
      "la cita sin enlace se ve como tal en Citas",
      listPend.some(
        (b) => b.id === withoutProvider.json?.bookingId && b.linkPending === true
      )
    );
  }

  // Se restaura el conector soberano para no dejar la instancia a medias.
  await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ connector: "enlace-fijo" }),
  });

  console.log("\n== 015: conector Zoom contra su mock ==");
  const zoomMockUp = await fetch(`${BASE}/api/dev/zoom-mock/_state`);
  if (!zoomMockUp.ok) {
    console.log("  (zoom-mock no disponible: se omiten los checks del conector)");
  } else {
    await fetch(`${BASE}/api/dev/zoom-mock/_reset`, { method: "POST" });

    const badOnes = await api("/api/settings/zoom", {
      method: "PUT",
      body: JSON.stringify({
        accountId: "acc",
        clientId: "cli",
        clientSecret: "secreto-invalid",
      }),
    });
    ok(
      "credenciales que el proveedor rechaza NO se guardan (422)",
      badOnes.res.status === 422,
      `status=${badOnes.res.status}`
    );
    ok(
      "…y la conexión sigue sin existir",
      (await api("/api/settings/zoom")).json?.connection === null
    );

    const good = await api("/api/settings/zoom", {
      method: "PUT",
      body: JSON.stringify({
        accountId: "acc",
        clientId: "cli",
        clientSecret: "secreto-bueno",
      }),
    });
    ok("credenciales válidas se guardan", good.res.ok, `status=${good.res.status}`);
    ok(
      "hacia el navegador solo salen los últimos 4 del secreto",
      good.json?.connection?.secretLast4 === "ueno" &&
        !JSON.stringify(good.json).includes("secreto-bueno"),
      JSON.stringify(good.json)
    );

    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ connector: "zoom" }),
    });
    const offerZoom = await bot(
      `/api/bot/availability?conversationId=${convB.id}&limit=12&perDay=3&days=5`
    );
    const slotZoom = (offerZoom.json?.slots ?? [])[0];
    if (slotZoom) {
      const withZoom = await bot("/api/bot/bookings", {
        method: "POST",
        body: JSON.stringify({
          conversationId: convB.id,
          startUtc: slotZoom.startUtc,
        }),
      });
      ok(
        "agendar con Zoom crea la reunión y devuelve su enlace",
        withZoom.res.status === 201 &&
          typeof withZoom.json?.meetingLink === "string" &&
          withZoom.json.meetingLink.includes("zoom.mock"),
        JSON.stringify(withZoom.json)
      );

      const status = await (await fetch(`${BASE}/api/dev/zoom-mock/_state`)).json();
      ok(
        "el proveedor recibió la reunión con su tema y su hora",
        status.meetings?.length === 1 &&
          status.meetings[0].topic.startsWith("Cita —"),
        JSON.stringify(status.meetings)
      );

      // Cancelar borra la reunión en el proveedor.
      await api(`/api/bookings/${withZoom.json.bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      });
      const estado2 = await (await fetch(`${BASE}/api/dev/zoom-mock/_state`)).json();
      ok(
        "cancelar la cita borra la reunión en el proveedor",
        (estado2.deleted ?? []).length === 1,
        JSON.stringify(estado2)
      );
    }

    await api("/api/settings/zoom", { method: "DELETE" });
    await api("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify({ connector: "enlace-fijo" }),
    });
  }

  await slotsByDateChecks();

  // El sandbox del Laboratorio (una cita de prueba jamás llega a un conector)
  // NO se verifica aquí: las conversaciones del Laboratorio no son alcanzables
  // desde la API pública —a propósito—, así que desde fuera solo podría
  // observarse por ausencia, que es una prueba débil. Vive en
  // `tests/unit/agenda-sandbox.test.ts`, que afirma lo que de verdad importa:
  // que el conector no se llama, ni al crear, ni al reprogramar, ni al
  // cancelar.
}

/* ============================================================
 * R10 — Huecos por fecha (tests/e2e/us-agenda.md, US3b)
 *
 * El fallo que lo motivó, en la prueba de punta a punta raíz + Nea: a
 * «¿tienen algo mañana en la tarde?» el cerebro solo recibía las tres
 * primeras horas de mañana y contestó que solo había mañana. Aquí se pide el
 * día con `date`, se reserva una hora de la TARDE y se comprueba que el
 * reparto sin `date` conserva su forma. Corre al final de 015 con un lead
 * propio: no toca la oferta de los demás.
 * ============================================================ */
async function slotsByDateChecks() {
  console.log("\n== R10: huecos por fecha (la tarde de mañana) ==");
  const tz = (await api("/api/calendar/settings")).json?.settings?.timezone;
  const dayIn = (offsetDays) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return new Date(Date.parse(`${today}T00:00:00Z`) + offsetDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
  };
  const tomorrow = dayIn(1);

  const SUF = Date.now().toString().slice(-6);
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: `5214629${SUF}`,
      name: "Lead R10 tarde",
      // Sin palabras que disparen al agente incluido a ofrecer o reservar.
      text: "¿tienen algo mañana en la tarde?",
      waMessageId: `wamid.e2e.r10.${SUF}.1`,
    }),
  });
  let conv = null;
  await until(async () => {
    const cs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = cs.find((c) => c.contact.phone === `524629${SUF}`) ?? null;
    return Boolean(conv);
  });
  ok("conversación del lead que pide la tarde", Boolean(conv));
  if (!conv) return;
  const q = `/api/bot/availability?conversationId=${conv.id}&limit=12&perDay=3&days=5`;

  // Sin date: la forma de siempre (+ query), y el porqué del fallo a la vista.
  const routing = await bot(q);
  const rSlots = routing.json?.slots ?? [];
  ok(
    "sin date: la misma forma (slots + diasConAgenda) y ahora query",
    routing.res.status === 200 &&
      Array.isArray(routing.json?.diasConAgenda) &&
      rSlots.length > 0 &&
      ["startUtc", "endUtc", "label", "dayIso", "dayLabel", "time"].every(
        (k) => k in rSlots[0]
      ),
    `status=${routing.res.status} keys=${Object.keys(routing.json ?? {})}`
  );
  ok(
    "sin date: query dice que es un reparto y hasta dónde revisó",
    routing.json?.query?.date === null &&
      routing.json?.query?.perDay === 3 &&
      /^\d{4}-\d{2}-\d{2}$/.test(routing.json?.query?.coveredUntil ?? "") &&
      /^\d{4}-\d{2}-\d{2}$/.test(routing.json?.query?.horizonEnd ?? ""),
    JSON.stringify(routing.json?.query)
  );

  // Con date: TODO mañana, tarde incluida.
  const ofTheDay = await bot(`${q}&date=${tomorrow}`);
  const dSlots = ofTheDay.json?.slots ?? [];
  ok(
    "con date: 200 con query.date = el día pedido y status available",
    ofTheDay.res.status === 200 &&
      ofTheDay.json?.query?.date === tomorrow &&
      ofTheDay.json?.query?.status === "available",
    `status=${ofTheDay.res.status} query=${JSON.stringify(ofTheDay.json?.query)}`
  );
  ok(
    "con date: solo horas de ese día, más de las 3 del reparto",
    dSlots.length > 3 && dSlots.every((s) => s.dayIso === tomorrow),
    `n=${dSlots.length}`
  );
  const late = dSlots.find((s) => s.time >= "15:00");
  ok(
    "con date: trae la TARDE (lo que el reparto no enseñaba)",
    Boolean(late),
    JSON.stringify(dSlots.map((s) => s.time))
  );

  // Consultas que no encuentran nada NO borran la oferta vigente.
  const far = dayIn(8);
  const outside = await bot(`${q}&date=${far}`);
  ok(
    "un día más allá del horizonte → beyond_horizon, sin horas",
    outside.res.status === 200 &&
      outside.json?.query?.status === "beyond_horizon" &&
      (outside.json?.slots ?? []).length === 0,
    `status=${outside.res.status} query=${JSON.stringify(outside.json?.query)}`
  );
  const bad = await bot(`${q}&date=2026-02-31`);
  ok(
    "una fecha inexistente → 422 invalid_body (no 500)",
    bad.res.status === 422 && bad.json?.error?.code === "invalid_body",
    `status=${bad.res.status}`
  );

  if (!late) return;
  const reservation = await bot("/api/bot/bookings", {
    method: "POST",
    body: JSON.stringify({ conversationId: conv.id, startUtc: late.startUtc }),
  });
  ok(
    "reservar una hora de la tarde ofrecida por fecha → 201",
    reservation.res.status === 201 && Boolean(reservation.json?.bookingId),
    `status=${reservation.res.status} body=${JSON.stringify(reservation.json)}`
  );
  ok(
    "la cita queda a la hora de la tarde elegida",
    typeof reservation.json?.label === "string" && reservation.json.label.includes(late.time),
    JSON.stringify(reservation.json?.label)
  );
  const again = await bot(`${q}&date=${tomorrow}`);
  ok(
    "la hora reservada ya no se ofrece para ese día",
    !(again.json?.slots ?? []).some((s) => s.startUtc === late.startUtc),
    `n=${(again.json?.slots ?? []).length}`
  );
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});

/* ============================================================
 * 016 — Atribución de anuncios y Conversions API (tests/e2e/us-attribution.md)
 *
 * Cubre las dos configuraciones de la bandera, la conexión del dataset, la
 * captura del anuncio, los dos eventos con la FORMA de su payload, el dedup,
 * y —lo que más importa— que un fallo de Meta jamás cuesta el movimiento del
 * lead.
 *
 * Los contactos llevan un sufijo por corrida: el dedup de conversiones es
 * permanente por diseño, así que re-correr el arnés contra la MISMA base
 * tiene que estrenar leads o estaría midiendo los de la corrida anterior.
 * ============================================================ */

async function attributionChecks() {
  const onValue = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.ATRIBUCION ?? "").trim()
  );
  const SUF = String(Date.now()).slice(-6);
  const tel = (n) => `52155${SUF}${n}`;
  const theName = (base) => `${base} ${SUF}`;

  console.log("\n== 016: la bandera de la atribución ==");

  if (!onValue) {
    for (const route of ["/api/settings/capi", "/api/settings/capi/events"]) {
      const { res } = await api(route);
      ok(
        `${route} → 404 con la atribución apagada`,
        res.status === 404,
        `status=${res.status}`
      );
    }
    const put = await api("/api/settings/capi", {
      method: "PUT",
      body: JSON.stringify({ datasetId: "ds-e2e" }),
    });
    ok(
      "PUT /api/settings/capi → 404 con la atribución apagada",
      put.res.status === 404,
      `status=${put.res.status}`
    );
    const page = await fetch(`${BASE}/settings/ads`, { headers: { cookie } });
    ok(
      "la pantalla /settings/ads no existe",
      page.status === 404,
      `status=${page.status}`
    );

    // Y un mensaje que SÍ viene de un anuncio se atiende como cualquier otro:
    // la instancia que no atribuye no se entera del referral, pero tampoco se
    // rompe con él.
    const inb = await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: tel("1"),
        name: theName("Lead con anuncio apagada"),
        text: "vi su anuncio",
        ctwaClid: "clid-apagada",
        waMessageId: `wamid.e2e.016.off.${SUF}`,
      }),
    });
    ok("inbound con anuncio entregado igual", inb.res.ok);
    // Con `preview` ya entró el mensaje, y el anuncio se guarda antes que él.
    let convOff = null;
    await until(async () => {
      const convs = (await api("/api/conversations")).json?.conversations ?? [];
      convOff = convs.find(
        (c) => c.contact.name === theName("Lead con anuncio apagada") && c.preview != null
      );
      return !!convOff;
    });
    ok("la conversación del anuncio existe (la ingesta no se rompe)", !!convOff);
    // 018 — La bandera ya no esconde DE QUÉ anuncio llegó: eso se ve siempre.
    // Lo que apaga es el identificador de clic, que ni se guarda.
    ok(
      "el origen del anuncio se ve igual con la bandera apagada (018)",
      convOff?.ad?.headline === "Anuncio de prueba",
      JSON.stringify(convOff?.ad)
    );
    const detailOff = convOff
      ? (await api(`/api/contacts/${convOff.contact.id}`)).json
      : null;
    ok(
      "pero sin identificador de clic: hasCtwaClid es false y el valor no aparece",
      detailOff?.ad?.hasCtwaClid === false &&
        !JSON.stringify(detailOff).includes("clid-apagada"),
      JSON.stringify(detailOff?.ad)
    );
    console.log(
      "  (atribución apagada: el resto de los checks de 016 no aplican)"
    );
    return;
  }

  /* ---------------- US2: conectar el dataset ---------------- */

  console.log("\n== 016: conectar el dataset (US2) ==");
  // Se parte de desconectado: así el primer check afirma lo que dice afirmar
  // aunque el arnés se re-corra sobre la misma base.
  await api("/api/settings/capi", { method: "DELETE" });
  const empty = await api("/api/settings/capi");
  ok(
    "sin configurar responde 200 con capi: null (no 404)",
    empty.res.status === 200 && empty.json?.capi === null,
    JSON.stringify(empty.json)
  );

  const board0 = (await api("/api/pipeline/board")).json;
  const qualifiedStage = board0.stages.filter((s) => s.kind === "open").at(-1);
  const wonStage = board0.stages.find((s) => s.kind === "won");
  const initialStage = board0.stages.find((s) => s.kind === "open");

  const foreignStage = await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e",
      qualifiedStageId: "stg_de_otro_negocio",
    }),
  });
  ok(
    "una etapa que no es del negocio se rechaza con 422 etapa_invalida",
    foreignStage.res.status === 422 &&
      foreignStage.json?.error?.code === "etapa_invalida",
    `status=${foreignStage.res.status} ${JSON.stringify(foreignStage.json)}`
  );

  const saved = await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e",
      qualifiedStageId: qualifiedStage.id,
    }),
  });
  ok(
    "se guarda el dataset sin pegar token",
    saved.res.ok,
    `status=${saved.res.status}`
  );

  const cfg = (await api("/api/settings/capi")).json?.capi;
  ok(
    "reusó el token de WhatsApp y solo muestra sus últimos 4",
    cfg?.datasetId === "ds-e2e" && cfg?.tokenLast4 === "-e2e",
    JSON.stringify(cfg)
  );
  ok(
    "el token completo NUNCA sale del servidor",
    !JSON.stringify(cfg).includes("tok-e2e"),
    JSON.stringify(cfg)
  );

  /* ---------------- US3 + US4: capturar y calificar ---------------- */

  console.log("\n== 016: del anuncio al lead calificado (US3/US4) ==");
  await api("/api/dev/wa-mock/capi-events", { method: "DELETE" });

  const CLID = `clid-e2e-${SUF}`;
  const NAME_AD = theName("Lead de anuncio");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("2"),
      name: NAME_AD,
      text: "hola, vengo del anuncio",
      ctwaClid: CLID,
      adHeadline: "Kit de verano",
      waMessageId: `wamid.e2e.016.ad.${SUF}.1`,
    }),
  });
  await sleep(1400);

  // Segundo mensaje con OTRO referral: el primero gana y no se sobreescribe.
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("2"),
      name: NAME_AD,
      text: "sigo aquí",
      ctwaClid: "clid-que-no-debe-ganar",
      waMessageId: `wamid.e2e.016.ad.${SUF}.2`,
    }),
  });
  await sleep(1200);

  const board1 = (await api("/api/pipeline/board")).json;
  const leadAd = board1.leads.find((l) => l.contact.name === NAME_AD);
  ok("el lead del anuncio existe en el tablero", !!leadAd);

  const mov1 = await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: qualifiedStage.id }),
  });
  ok(
    "el lead se mueve a la etapa calificada",
    mov1.res.ok,
    `status=${mov1.res.status}`
  );
  await sleep(800);

  const act1 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const qualified = act1.find(
    (e) => e.eventName === "QualifiedLead" && e.contactName === NAME_AD
  );
  ok(
    "se reportó QualifiedLead con acuse de Meta",
    qualified?.status === "sent" && !!qualified?.fbTraceId,
    JSON.stringify(qualified)
  );
  ok(
    "la actividad dice de qué anuncio vino",
    qualified?.adHeadline === "Kit de verano",
    JSON.stringify(qualified)
  );

  const capi1 = (await api("/api/dev/wa-mock/capi-events")).json?.capiEvents ?? [];
  const evento1 = capi1.find((e) => e.eventName === "QualifiedLead");
  ok(
    "el evento viajó con el ctwa_clid del PRIMER referral",
    evento1?.ctwaClid === CLID,
    JSON.stringify(evento1?.ctwaClid)
  );
  ok(
    "y con custom_data.lead_stage (lo único reglable en Meta)",
    evento1?.customData?.lead_stage === "qualified",
    JSON.stringify(evento1?.customData)
  );

  // Dedup: sacarlo y volverlo a meter no re-reporta.
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: initialStage.id }),
  });
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: qualifiedStage.id }),
  });
  await sleep(800);
  const act2 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const thisQuals = act2.filter(
    (e) => e.eventName === "QualifiedLead" && e.contactName === NAME_AD
  );
  ok(
    "volver a calificar NO reporta dos veces",
    thisQuals.length === 1,
    `${thisQuals.length} filas`
  );

  /* ---------------- US5: la venta ---------------- */

  console.log("\n== 016: la venta (US5) ==");
  const sale = await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stageId: wonStage.id,
      amountCents: 45050,
      currency: "MXN",
    }),
  });
  ok("el trato se marca como ganado", sale.res.ok, `status=${sale.res.status}`);
  await sleep(800);

  const act3 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const purchase = act3.find(
    (e) => e.eventName === "Purchase" && e.contactName === NAME_AD
  );
  ok("se reportó la venta", purchase?.status === "sent", JSON.stringify(purchase));

  const capi2 = (await api("/api/dev/wa-mock/capi-events")).json?.capiEvents ?? [];
  const evento2 = capi2.find((e) => e.eventName === "Purchase");
  ok(
    "la venta viajó en UNIDADES de la moneda, no en centavos",
    evento2?.customData?.value === 450.5 &&
      evento2?.customData?.currency === "MXN",
    JSON.stringify(evento2?.customData)
  );

  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: qualifiedStage.id }),
  });
  await api(`/api/pipeline/leads/${leadAd.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: wonStage.id }),
  });
  await sleep(800);
  const act4 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const thisPurchases = act4.filter(
    (e) => e.eventName === "Purchase" && e.contactName === NAME_AD
  );
  ok(
    "re-ganar NO manda una segunda compra (a Meta no se le des-envía nada)",
    thisPurchases.length === 1,
    `${thisPurchases.length} filas`
  );

  /* ---------------- Los caminos infelices ---------------- */

  console.log("\n== 016: caminos infelices ==");

  // Un lead que no vino de un anuncio: se registra el motivo y nada falla.
  const NAME_ORG = theName("Lead organico");
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("3"),
      name: NAME_ORG,
      text: "hola",
      waMessageId: `wamid.e2e.016.org.${SUF}`,
    }),
  });
  await sleep(1400);
  const board2 = (await api("/api/pipeline/board")).json;
  const leadOrg = board2.leads.find((l) => l.contact.name === NAME_ORG);
  await api(`/api/pipeline/leads/${leadOrg.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: qualifiedStage.id }),
  });
  await sleep(800);
  const act5 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const omitted = act5.find((e) => e.contactName === NAME_ORG);
  ok(
    "un lead sin anuncio queda OMITIDO con el motivo escrito",
    omitted?.status === "skipped" && /ctwa_clid/.test(omitted?.error ?? ""),
    JSON.stringify(omitted)
  );

  // Meta rechazando: el 200 mentiroso (events_received: 0).
  const NAME_FAIL = theName("Lead con Meta caido");
  await api("/api/settings/capi", {
    method: "PUT",
    body: JSON.stringify({
      datasetId: "ds-e2e-fail",
      qualifiedStageId: qualifiedStage.id,
    }),
  });
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel("4"),
      name: NAME_FAIL,
      text: "vengo del anuncio",
      ctwaClid: `clid-fail-${SUF}`,
      waMessageId: `wamid.e2e.016.fail.${SUF}`,
    }),
  });
  await sleep(1400);
  const board3 = (await api("/api/pipeline/board")).json;
  const leadFail = board3.leads.find((l) => l.contact.name === NAME_FAIL);
  const movFail = await api(`/api/pipeline/leads/${leadFail.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: qualifiedStage.id }),
  });
  ok(
    "con Meta rechazando, el lead SE MUEVE igual",
    movFail.res.ok,
    `status=${movFail.res.status}`
  );
  await sleep(800);
  const board4 = (await api("/api/pipeline/board")).json;
  const leadFail2 = board4.leads.find((l) => l.contact.name === NAME_FAIL);
  ok(
    "y se queda en la etapa a la que lo movieron",
    leadFail2?.stageId === qualifiedStage.id,
    JSON.stringify(leadFail2?.stageId)
  );
  const act6 = (await api("/api/settings/capi/events")).json?.events ?? [];
  const failed = act6.find((e) => e.contactName === NAME_FAIL);
  ok(
    "la fila queda FALLIDA con lo que dijo Meta (200 pero events_received=0)",
    failed?.status === "failed" &&
      /events_received=0/.test(failed?.error ?? ""),
    JSON.stringify(failed)
  );

  // Desconectar: deja de reportarse, pero la bitácora de lo ya dicho se queda.
  const del = await api("/api/settings/capi", { method: "DELETE" });
  ok("se puede desconectar", del.res.ok);
  const afterDelete = (await api("/api/settings/capi")).json;
  ok("tras desconectar, no hay configuración", afterDelete?.capi === null);
  const act7 = (await api("/api/settings/capi/events")).json?.events ?? [];
  ok(
    "los eventos ya reportados NO se borran al desconectar",
    act7.length >= 3,
    `${act7.length} filas`
  );
}

/* ============================================================
 * 018 — De qué anuncio llegó cada conversación (tests/e2e/us-attribution.md)
 *
 * Corre con la bandera ATRIBUCION apagada Y encendida: el origen del anuncio
 * se ve siempre, y lo único que cambia es si Meta identificó el clic. Puerto
 * de las secciones 1-4b del guion de la spec 212 de Vocero Cloud, sin las
 * comprobaciones entre organizaciones (aquí hay una).
 *
 * Los creativos los sirve el wa-mock (`/api/dev/wa-mock/media-file/creativo-*`),
 * en el origen de META_GRAPH_BASE_URL: el único que la copia acepta fuera de
 * los hosts de Meta, y solo con los mocks habilitados.
 * ============================================================ */

async function originAdChecks() {
  const attributes = /^(on|1|true|si|sí|yes)$/i.test(
    (process.env.ATRIBUCION ?? "").trim()
  );
  const RUN = String(Date.now()).slice(-6);
  const tel = (n) => `52156${RUN}${String(n).padStart(2, "0")}`;
  const nameValue = (n) => `Anuncio ${RUN} ${n}`;
  let originMock = BASE;
  try {
    originMock = new URL(process.env.META_GRAPH_BASE_URL).origin;
  } catch {
    /* sin META_GRAPH_BASE_URL: el propio BASE */
  }
  const creative = (id) => `${originMock}/api/dev/wa-mock/media-file/${id}`;
  const referralCtwa = ({ id, headline: headline, image: image, kind: kind = "ad" }) => ({
    source_url: `https://fb.me/anuncio-${RUN}-${id}`,
    source_id: `1202${RUN}${id}`,
    source_type: kind,
    headline: headline,
    body: `Texto del anuncio ${id}`,
    media_type: "image",
    image_url: image,
    ctwa_clid: `clid-018-${RUN}-${id}`,
  });
  const enters = (n, text, referral, waMessageId = `wamid.e2e.018.${RUN}.${n}`) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({
        phoneNumberId: PN,
        from: tel(n),
        name: nameValue(n),
        text: text,
        waMessageId,
        ...(referral ? { referral } : {}),
      }),
    });
  // El webhook procesa en `after()`: la conversación existe un instante antes
  // que su anuncio y su mensaje. Con `preview` ya hay mensaje, y el anuncio se
  // guarda ANTES que el mensaje: a partir de ahí lo que diga la lista es final.
  const conversationOf = async (n) => {
    let found = null;
    await until(async () => {
      const convs = (await api("/api/conversations")).json?.conversations ?? [];
      found =
        convs.find((c) => c.contact.name === nameValue(n) && c.preview != null) ?? null;
      return !!found;
    });
    return found;
  };
  const detailValue = async (contactId) =>
    (await api(`/api/contacts/${contactId}`)).json;
  const imageOf = async (contactId, ms = 15000) => {
    let id = null;
    await until(async () => {
      id = (await detailValue(contactId))?.ad?.imageAssetId ?? null;
      return !!id;
    }, ms);
    return id;
  };

  console.log(
    `\n== 018: de qué anuncio llegó (ATRIBUCION ${attributes ? "encendida" : "apagada"}) ==`
  );
  // En `next dev` una ruta se compila en su primera petición y eso puede tardar
  // más que la espera de la copia: se calientan antes de medir.
  await fetch(creative("creativo-calentamiento")).catch(() => null);
  await api("/api/media/calentamiento").catch(() => null);

  /* ---------- 1 · el primer mensaje trae su anuncio ---------- */
  const R1 = referralCtwa({ id: 1, headline: `Diagnóstico gratis ${RUN}`, image: creative(`creativo-azul-${RUN}`) });
  const R2 = referralCtwa({ id: 2, headline: `Segundo anuncio ${RUN}`, image: creative(`creativo-rojo-${RUN}`) });
  const inb1 = await enters(1, `Hola, vi su anuncio ${RUN}`, R1);
  ok("el webhook acepta el mensaje con referral", inb1.res.ok, `status=${inb1.res.status}`);
  const conv1 = await conversationOf(1);
  ok(
    "la lista trae el anuncio con su titular",
    conv1?.ad?.headline === R1.headline &&
      conv1?.ad?.sourceId === R1.source_id &&
      conv1?.ad?.sourceType === "ad",
    JSON.stringify(conv1?.ad)
  );
  const d1 = conv1 ? await detailValue(conv1.contact.id) : null;
  const an = d1?.ad;
  ok(
    "el detalle del contacto trae el anuncio completo",
    an?.sourceId === R1.source_id && an?.sourceType === "ad" &&
      an?.sourceUrl === R1.source_url && an?.body === R1.body &&
      an?.mediaType === "image" && !!an?.capturedAt,
    JSON.stringify(an)
  );
  ok(
    attributes
      ? "con la bandera encendida, Meta identificó el clic (hasCtwaClid)"
      : "con la bandera apagada, no hay clic que identificar (hasCtwaClid false)",
    an?.hasCtwaClid === attributes,
    JSON.stringify(an)
  );
  const lista1 = (await api("/api/conversations")).json;
  ok(
    "el ctwa_clid no sale por la API",
    !JSON.stringify(d1 ?? {}).includes(R1.ctwa_clid) &&
      !JSON.stringify(lista1 ?? {}).includes(R1.ctwa_clid),
    "¡la respuesta traía el identificador de clic!"
  );
  ok(
    "la fuente sin capturar se deduce «anuncio»",
    d1?.contact?.source?.value === "anuncio" &&
      d1?.contact?.source?.source === "deducida",
    JSON.stringify(d1?.contact?.source)
  );
  const imageR1 = conv1 ? await imageOf(conv1.contact.id) : null;
  ok("la imagen del creativo queda guardada", !!imageR1, "imageAssetId siguió en null");
  if (imageR1) {
    const media = await fetch(`${BASE}/api/media/${imageR1}`, { headers: { cookie } });
    const bytes = Buffer.from(await media.arrayBuffer());
    ok(
      "y se sirve como PNG con sesión",
      media.status === 200 &&
        media.headers.get("content-type") === "image/png" &&
        bytes.subarray(1, 4).toString() === "PNG",
      `status ${media.status}, tipo ${media.headers.get("content-type")}, ${bytes.length} bytes`
    );
    const withoutSession = await fetch(`${BASE}/api/media/${imageR1}`);
    ok("sin sesión no se sirve", withoutSession.status === 401, `status=${withoutSession.status}`);
  }

  /* ---------- 2 · el primer anuncio gana y nada se duplica ---------- */
  const theInbound = async () =>
    conv1
      ? ((await api(`/api/conversations/${conv1.id}/messages`)).json?.messages ?? [])
          .filter((m) => m.direction === "in").length
      : -1;
  const before = await theInbound();
  // Reentrega exacta del primer mensaje, como hace Meta, y un segundo mensaje
  // de la misma persona desde OTRO anuncio.
  await enters(1, `Hola, vi su anuncio ${RUN}`, R1);
  await enters(1, `Vi otro anuncio ${RUN}`, R2, `wamid.e2e.018.${RUN}.1b`);
  await until(async () => (await theInbound()) >= before + 1);
  await sleep(600); // por si la reentrega llegara a colarse después
  const after = await theInbound();
  const conv1b = await conversationOf(1);
  ok(
    "el segundo mensaje entra en la misma conversación y el anuncio sigue siendo el primero",
    conv1b?.id === conv1?.id && conv1b?.ad?.sourceId === R1.source_id,
    JSON.stringify({ id: conv1b?.id, ad: conv1b?.ad })
  );
  ok(
    "la reentrega no duplicó el mensaje",
    after === before + 1,
    `entrantes antes ${before}, después ${after} (se esperaba +1)`
  );

  /* ---------- 3 · la imagen se copia una vez por anuncio ---------- */
  await enters(3, `Otra persona, mismo anuncio ${RUN}`, { ...R1, ctwa_clid: `clid-otro-${RUN}` });
  const conv3 = await conversationOf(3);
  const imagen3 = conv3 ? await imageOf(conv3.contact.id) : null;
  ok(
    "otra conversación del mismo anuncio usa la misma imagen",
    !!imageR1 && imagen3 === imageR1,
    `imagen ${imagen3} vs ${imageR1}`
  );

  /* ---------- 4 · lo que no se descarga no rompe la ingesta ---------- */
  const testCases = [
    { n: 4, name: "host que no es de Meta", image: "https://example.com/creativo.png" },
    { n: 5, name: "redirección a otro host", image: creative("creativo-redirige") },
    { n: 6, name: "un SVG", image: creative("creativo-svg") },
    { n: 7, name: "más de 300 KB", image: creative("creativo-enorme") },
  ];
  for (const testCase of testCases) {
    await enters(testCase.n, `Caso ${testCase.n} ${RUN}`, referralCtwa({ id: 10 + testCase.n, headline: `Caso ${testCase.n} ${RUN}`, image: testCase.image }));
    const conv = await conversationOf(testCase.n);
    ok(`${testCase.name}: el mensaje y el anuncio entran`, !!conv?.ad, JSON.stringify(conv?.ad));
    testCase.contactId = conv?.contact?.id;
  }
  await sleep(3000); // la copia en segundo plano termina (o no)
  for (const testCase of testCases) {
    const d = testCase.contactId ? await detailValue(testCase.contactId) : null;
    ok(
      `${testCase.name}: sin imagen, y la tarjeta sigue`,
      !!d?.ad && d.ad.imageAssetId === null,
      JSON.stringify(d?.ad)
    );
  }

  await enters(8, `Escribí sin anuncio ${RUN}`);
  const convOrg = await conversationOf(8);
  const dOrg = convOrg ? await detailValue(convOrg.contact.id) : null;
  ok(
    "una conversación orgánica no tiene anuncio",
    !!convOrg && convOrg.ad === null && dOrg?.ad === null &&
      dOrg?.contact?.source?.value === "desconocida",
    `lista ${JSON.stringify(convOrg?.ad)}, detalle ${JSON.stringify(dOrg?.ad)}`
  );

  await enters(9, `Referral sin datos ${RUN}`, { body: "sin nada que identifique", media_type: "image" });
  const convJunk = await conversationOf(9);
  ok(
    "un referral sin nada útil no crea anuncio, y el mensaje entra",
    !!convJunk && convJunk.ad === null,
    JSON.stringify(convJunk?.ad)
  );

  await enters(10, `Desde una publicación ${RUN}`, referralCtwa({ id: 30, headline: `Publicación ${RUN}`, image: creative(`creativo-verde-${RUN}`), kind: "post" }));
  const convPub = await conversationOf(10);
  const dPub = convPub ? await detailValue(convPub.contact.id) : null;
  ok(
    "una publicación se enseña, pero no cuenta como fuente «anuncio»",
    convPub?.ad?.sourceType === "post" && dPub?.contact?.source?.value === "desconocida",
    `lista ${JSON.stringify(convPub?.ad)}, fuente ${JSON.stringify(dPub?.contact?.source)}`
  );

  /* ---------- 4b · un tropiezo de red no deja la tarjeta sin imagen ---------- */
  // La primera petición tarda más que la espera de la copia: el reintento la trae.
  await enters(13, `Creativo lento ${RUN}`, referralCtwa({ id: 40, headline: `Lento ${RUN}`, image: creative(`creativo-lento-${RUN}`) }));
  const slowConv = await conversationOf(13);
  const slowImage = slowConv ? await imageOf(slowConv.contact.id, 25000) : null;
  ok("una descarga que se cuelga una vez se reintenta y llega", !!slowImage, "la imagen no llegó tras el reintento");

  // Falla la copia y su reintento (503 dos veces): la repara abrir el contacto.
  await enters(14, `Creativo que falla ${RUN}`, referralCtwa({ id: 41, headline: `Falla ${RUN}`, image: creative(`creativo-falla-${RUN}`) }));
  const convFailure = await conversationOf(14); // la lista no repara nada
  await sleep(4000);
  const first = convFailure ? await detailValue(convFailure.contact.id) : null;
  ok(
    "tras dos fallos la tarjeta llega sin imagen",
    !!first?.ad && first.ad.imageAssetId === null,
    JSON.stringify(first?.ad)
  );
  const repaired = convFailure ? await imageOf(convFailure.contact.id, 16000) : null;
  ok("y abrir el contacto la repara en segundo plano", !!repaired, "la imagen no se reparó");
}

/* ============================================================
 * R11 — Robustez de la API del bot (sección autocontenida)
 *
 * Cada parte dice qué rompía antes. Todo lleva un sufijo por corrida:
 * re-correr contra la misma base (o dentro de la ventana del limitador) no
 * puede medir lo de la corrida anterior.
 * ============================================================ */
async function r11BotChecks() {
  const RUN = Date.now().toString().slice(-6);

  /*
   * 1. Una inundación sin key desde UNA IP no le quita el turno al cerebro.
   *    Antes: un cubo global contado ANTES de autenticar → 429 para Nea el
   *    resto de la ventana, y clientes sin respuesta.
   */
  console.log("\n== R11: 700 requests sin key desde una IP vs. el cerebro ==");
  const reference = ((await api("/api/conversations")).json?.conversations ?? [])[0];
  ok("hay una conversación para que el cerebro pregunte", Boolean(reference));
  // Una IP por corrida: la de la corrida anterior puede seguir frenada.
  const IP = `10.${Number(RUN.slice(0, 2))}.${Number(RUN.slice(2, 4))}.${Number(RUN.slice(4, 6))}`;
  const attempt = (key, ip = IP) =>
    fetch(`${BASE}/api/bot/context?conversationId=${reference?.id}`, {
      headers: { "x-forwarded-for": ip, ...(key ? { "x-api-key": key } : {}) },
    }).then((r) => r.status);
  const seen = {};
  const brainDuring = [];
  for (let lote = 0; lote < 14; lote++) {
    const failedValue = Array.from({ length: 50 }, (_, i) =>
      attempt(i % 2 ? "clave-equivocada-0123456789" : undefined)
    );
    // El cerebro pregunta EN MEDIO de la inundación, desde otra IP y desde
    // la misma (mismo proxy, o sin proxy donde todo es "local").
    const brain = lote === 7 ? [attempt(BOT_KEY, "10.255.0.1"), attempt(BOT_KEY)] : [];
    const [statuses, fromBrain] = await Promise.all([
      Promise.all(failedValue),
      Promise.all(brain),
    ]);
    for (const s of statuses) seen[s] = (seen[s] ?? 0) + 1;
    brainDuring.push(...fromBrain);
  }
  ok(
    "la inundación: 30 → 401 y las otras 670 → 429 (frenada por IP)",
    seen[401] === 30 && seen[429] === 670,
    JSON.stringify(seen)
  );
  ok(
    "el cerebro DURANTE la inundación → 200 (otra IP y la misma)",
    brainDuring.length === 2 && brainDuring.every((s) => s === 200),
    JSON.stringify(brainDuring)
  );
  const after = [await attempt(BOT_KEY, "10.255.0.1"), await attempt(BOT_KEY)];
  ok(
    "el cerebro DESPUÉS de la inundación → 200",
    after.every((s) => s === 200),
    JSON.stringify(after)
  );
  const otherIp = await attempt(undefined, `10.254.${Number(RUN.slice(2, 4))}.${Number(RUN.slice(4, 6))}`);
  ok("otra IP sin key sigue en 401 (el freno es por IP, no global)", otherIp === 401, `status=${otherIp}`);

  /*
   * 2. Quien escribió primero CON teléfono y luego llega solo con BSUID: el
   *    contexto por `bsuid:<id>` es su contacto. Antes: 404, y el cerebro
   *    no podía contestarle.
   */
  console.log("\n== R11: contexto por BSUID de quien escribió con teléfono ==");
  const inbound = (body) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN, ...body }),
    });
  const convDe = async (canonical) =>
    ((await api("/api/conversations")).json?.conversations ?? []).find(
      (c) => c.contact.phone === canonical
    );
  const messagesOf = async (id) =>
    (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
  const CANON = `524629${RUN}`;
  const BSU = `MX.r11.${RUN}`;
  const NAME = `R11 BSUID ${RUN}`;
  await inbound({
    from: `5214629${RUN}`,
    fromUserId: BSU,
    name: NAME,
    text: "hola, les escribo con mi número",
    waMessageId: `wamid.e2e.r11.tel.${RUN}`,
  });
  await until(async () => Boolean(await convDe(CANON)));
  const conv = await convDe(CANON);
  ok("el contacto nace con el teléfono como identidad", Boolean(conv));

  // Meta ya no manda el teléfono: solo el BSUID.
  await inbound({
    fromUserId: BSU,
    name: NAME,
    text: "y ahora sin número",
    waMessageId: `wamid.e2e.r11.bsu.${RUN}`,
  });
  const reconciled = await until(async () =>
    conv ? (await messagesOf(conv.id)).some((m) => m.text === "y ahora sin número") : false
  );
  ok("la ingesta reconcilia el mensaje solo-BSUID a la MISMA conversación", reconciled);

  const bsuid = encodeURIComponent(`bsuid:${BSU}`);
  const byBsuid = await bot(`/api/bot/context?waIdentity=${bsuid}`);
  ok(
    "GET /api/bot/context?waIdentity=bsuid:<id> → 200 (antes 404)",
    byBsuid.res.status === 200,
    `status=${byBsuid.res.status}`
  );
  ok(
    "…y es el MISMO contacto y conversación (su identidad sigue siendo el teléfono)",
    byBsuid.json?.conversation?.id === conv?.id &&
      byBsuid.json?.contact?.waIdentity === CANON,
    JSON.stringify({ conv: byBsuid.json?.conversation?.id, contact: byBsuid.json?.contact })
  );
  const neutral = await bot(`/api/bot/context?identity=${bsuid}`);
  ok(
    "el nombre neutro `identity` resuelve igual",
    neutral.json?.conversation?.id === conv?.id,
    `status=${neutral.res.status}`
  );
  const nobody = await bot(
    `/api/bot/context?waIdentity=${encodeURIComponent(`bsuid:MX.r11.nadie.${RUN}`)}`
  );
  ok("un BSUID que nadie tiene sigue en 404", nobody.res.status === 404, `status=${nobody.res.status}`);

  /*
   * 3. Pedir cita con la agenda apagada no termina en "Error del proveedor
   *    de IA": el ai-mock ya no ofrece horarios que el prompt no le enseñó
   *    (el esquema del turno los rechazaba y el agente traspasaba).
   */
  const agenda = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
  console.log(`\n== R11: pedir cita con la agenda ${agenda ? "encendida" : "apagada"} ==`);
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const CANON_BOOKING = `524630${RUN}`;
  await inbound({
    from: `5214630${RUN}`,
    name: `R11 Cita ${RUN}`,
    text: "hola, ¿dan citas el sábado?",
    waMessageId: `wamid.e2e.r11.cita.${RUN}`,
  });
  const outboundBooking = async () => {
    const c = await convDe(CANON_BOOKING);
    return c ? (await messagesOf(c.id)).filter((m) => m.direction === "out") : [];
  };
  await until(
    async () =>
      Boolean((await convDe(CANON_BOOKING))?.handoffAt) || (await outboundBooking()).length > 0,
    25000
  );
  const convBooking = await convDe(CANON_BOOKING);
  const outbound = await outboundBooking();
  ok(
    "el agente contesta y NO traspasa por «Error del proveedor de IA»",
    !convBooking?.handoffAt && outbound.some((m) => m.origin === "ai"),
    JSON.stringify({ reason: convBooking?.handoffReason, outbound: outbound.map((m) => m.text) })
  );
  if (!agenda) {
    ok(
      "con la agenda apagada no ofrece horarios",
      !outbound.some((m) => /horario/i.test(m.text ?? "")),
      JSON.stringify(outbound.map((m) => m.text))
    );
  }
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: false }) });
}

/**
 * 028 — Latido al servicio central (tests/e2e/us-central-heartbeat.md). Con la
 * bandera apagada, la superficie no existe. Encendida, apunta al mock del
 * central de este mismo CRM (`INTO_CENTRAL_URL=${BASE}/api/dev/central-mock`):
 * el final de la llave elige la respuesta del mock.
 */
async function centralChecks() {
  const isOn = Boolean((process.env.INTO_CENTRAL_URL ?? "").trim());
  console.log(`\n== 028: latido al servicio central (${isOn ? "encendido" : "apagado"}) ==`);
  const health = await api("/api/health");
  ok("features.central dice lo que hace la app (AC1)", health.json?.features?.central === isOn, JSON.stringify(health.json?.features));

  if (!isOn) {
    const off = await api("/api/settings/central");
    ok("sin la bandera, /api/settings/central no existe (AC1)", off.res.status === 404, `status=${off.res.status}`);
    const pageValue = await fetch(`${BASE}/settings/central`, { headers: { cookie } });
    ok("sin la bandera, la página Plan no existe (AC1)", pageValue.status === 404, `status=${pageValue.status}`);
    return;
  }

  const keyValue = (end) => `into_live_${"E2e".repeat(9)}A${end}`; // 10 + 28 + 4 = into_live_ + 32
  const last = async () => (await api("/api/dev/central-mock/v1/heartbeat")).json?.last ?? null;

  await api("/api/settings/central", { method: "DELETE" });
  const isEmpty = await api("/api/settings/central");
  ok("encendido y sin llave: pide la llave y no late (AC2)", isEmpty.res.ok && isEmpty.json?.license === null, JSON.stringify(isEmpty.json));

  const before = JSON.stringify(await last());
  const bad = await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: "into_live_corta" }) });
  ok("una llave con otro formato se rechaza (AC4)", bad.res.status === 422, `status=${bad.res.status}`);
  ok("…sin llamar al central (AC4)", JSON.stringify(await last()) === before);

  const goodValue = keyValue("1234");
  const put = await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: goodValue }) });
  const license = put.json?.license;
  ok(
    "guardar la llave late en ese momento y muestra el plan (AC3)",
    put.res.ok && license?.plan?.code === "CE-PYM" && license?.plan?.name === "Pyme" && license?.account === "active" && license?.lastResult === "ok",
    JSON.stringify(put.json)
  );
  ok("la llave se ve solo como sus últimos 4 (AC3, AC5)", license?.keyLast4 === "1234");
  const text = await (await fetch(`${BASE}/api/settings/central`, { headers: { cookie } })).text();
  ok("la llave no sale en la respuesta de la API (AC5)", !text.includes(goodValue) && !JSON.stringify(put.json).includes(goodValue));

  const bodyValue = await last();
  const ids = (bodyValue?.checks ?? []).map((c) => c.id);
  ok(
    "el latido lleva solo lo del contrato (AC5)",
    bodyValue &&
      Object.keys(bodyValue).every((k) => ["app_version", "app_commit", "app_started_at", "checks"].includes(k)) &&
      JSON.stringify(ids) === JSON.stringify(["database", "media_dir", "whatsapp", "ai", "dispatch"]) &&
      bodyValue.checks.every((c) => Object.keys(c).join() === "id,status" && ["ok", "warn", "fail", "skip"].includes(c.status)),
    JSON.stringify(bodyValue)
  );
  ok("…con WhatsApp conectado por el wa-mock", bodyValue?.checks?.find((c) => c.id === "whatsapp")?.status === "ok", JSON.stringify(bodyValue?.checks));
  ok("…y sin la llave dentro", !JSON.stringify(bodyValue).includes(goodValue));

  const rejected = await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: keyValue("0000") }) });
  ok(
    "una llave que el central rechaza se guarda y lo dice (AC4)",
    rejected.res.ok && rejected.json?.license?.lastResult === "llave_invalida" && rejected.json?.license?.plan === null,
    JSON.stringify(rejected.json)
  );

  const isDown = await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: keyValue("5000") }) });
  ok("con el central fallando, responde y dice «sin respuesta» (AC6)", isDown.res.ok && isDown.json?.license?.lastResult === "sin_respuesta", JSON.stringify(isDown.json));
  const continues = await api("/api/conversations");
  ok("…y el CRM sigue atendiendo (AC6)", continues.res.ok);

  const suspended = await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: keyValue("9999") }) });
  ok("una cuenta suspendida se muestra, sin limitar nada (D4)", suspended.json?.license?.account === "suspended", JSON.stringify(suspended.json));

  // AC9: la pantalla a 360 px, con el plan a la vista y sin scroll horizontal.
  await api("/api/settings/central", { method: "PUT", body: JSON.stringify({ key: goodValue }) });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/settings/central`);
    const plan = await page.getByTestId("central-plan").textContent({ timeout: 15000 }).catch(() => null);
    ok("Plan muestra el plan en el teléfono (AC3, AC9)", plan === "Pyme", String(plan));
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok("Plan a 360 px sin scroll horizontal (AC9)", !overflows);
    ok("la llave no está en el HTML de la página (AC5)", !(await page.content()).includes(goodValue));
  } finally {
    await browser.close();
  }

  const remove = await api("/api/settings/central", { method: "DELETE" });
  ok("quitar la llave borra lo guardado (AC7)", remove.res.ok && remove.json?.license === null, JSON.stringify(remove.json));
}

/**
 * 029 — «A quién llamar hoy» (tests/e2e/us-today.md). El operador del arnés es
 * el dueño (supervisor): ve la lista de todos.
 */
async function todayChecks() {
  console.log("\n== 029: a quién llamar hoy ==");
  const RUN = Date.now().toString().slice(-6);
  const list = async () => (await api("/api/today")).json;
  const section = (data, id) => data?.sections?.find((s) => s.id === id)?.items ?? [];
  const thisOne = (data, id, nameValue) => section(data, id).some((i) => i.name === nameValue);

  let data = await list();
  ok("«Hoy» responde con sus tres secciones (AC2)", JSON.stringify(data?.sections?.map((s) => s.id)) === '["overdue","today","first_contact"]', JSON.stringify(data?.sections?.map((s) => s.id)));
  ok("…en el día del negocio", /^\d{4}-\d{2}-\d{2}$/.test(data?.today ?? ""));
  ok("el supervisor puede elegir de quién ver la lista (D4)", data?.canFilter === true);
  const today = data.today;
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  // Dos leads nuevos por WhatsApp: a nadie se le ha escrito todavía.
  const newOnes = [`Hoy Nuevo ${RUN}`, `Hoy Respondido ${RUN}`];
  for (const [i, nameValue] of newOnes.entries()) {
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN, from: `52155${RUN}${i}`, name: nameValue, text: "hola, ¿info?", waMessageId: `wamid.e2e.029.${RUN}.${i}` }),
    });
  }
  await until(async () => thisOne(await list(), "first_contact", newOnes[1]), 15000);
  data = await list();
  ok("un lead nuevo al que nadie escribió está en «Sin primer contacto» (D3)", thisOne(data, "first_contact", newOnes[0]) && thisOne(data, "first_contact", newOnes[1]));

  // Contestarle lo saca de ahí (AC4).
  const answeredValue = section(data, "first_contact").find((i) => i.name === newOnes[1]);
  const sending = await api(`/api/conversations/${answeredValue?.conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: "¡Hola! Te cuento" }) });
  ok("el operador le contesta", sending.res.ok, JSON.stringify(sending.json));
  await until(async () => !thisOne(await list(), "first_contact", newOnes[1]), 10000);
  ok("…y sale de «Sin primer contacto» (AC4)", !thisOne(await list(), "first_contact", newOnes[1]));

  // Fijar el próximo contacto desde el PATCH del lead (AC1).
  const lead = section(await list(), "first_contact").find((i) => i.name === newOnes[0]);
  const bad = await api(`/api/pipeline/leads/${lead?.leadId}`, { method: "PATCH", body: JSON.stringify({ followUpOn: "2026-02-30" }) });
  ok("una fecha inválida se rechaza (AC1, 422)", bad.res.status === 422, `status=${bad.res.status}`);
  const fixed = await api(`/api/pipeline/leads/${lead?.leadId}`, { method: "PATCH", body: JSON.stringify({ followUpOn: today, followUpNote: "pide el precio" }) });
  ok("se fija el próximo contacto para hoy con su nota (AC1)", fixed.res.ok && fixed.json?.lead?.followUpOn === today && fixed.json?.lead?.followUpNote === "pide el precio", JSON.stringify(fixed.json?.lead));
  data = await list();
  ok("aparece en «Para hoy» y ya no en «Sin primer contacto» (AC2)", thisOne(data, "today", newOnes[0]) && !thisOne(data, "first_contact", newOnes[0]));
  const board = (await api("/api/pipeline/board")).json;
  ok("el tablero trae el próximo contacto para el cajón", board?.leads?.find((l) => l.id === lead?.leadId)?.followUpOn === today && board?.today === today);

  // «Hecho» → «Mañana», desde la pantalla, a 360 px (AC6, AC7).
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/today`);
    const row = page.getByTestId("today-row").filter({ hasText: newOnes[0] });
    await row.waitFor({ timeout: 20000 }).catch(() => {});
    ok("«Hoy» muestra el lead con su nota en el teléfono", (await row.textContent().catch(() => ""))?.includes("pide el precio") ?? false);
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok("«Hoy» a 360 px sin scroll horizontal (AC7)", !overflows);
    await row.getByRole("button", { name: "Hecho" }).click();
    // La fila sale al instante (optimista); se espera a que el servidor guarde.
    const saved = page.waitForResponse((r) => r.url().includes(`/api/pipeline/leads/${lead?.leadId}`) && r.request().method() === "PATCH");
    await page.getByRole("menuitem", { name: "Mañana" }).click();
    await saved.catch(() => {});
    await row.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    ok("«Hecho» → «Mañana» lo saca de la lista (AC6)", (await row.count()) === 0);
  } finally {
    await browser.close();
  }
  const after = (await api("/api/pipeline/board")).json?.leads?.find((l) => l.id === lead?.leadId);
  ok("…y deja la fecha en mañana con su nota (AC6)", after?.followUpOn === tomorrow && after?.followUpNote === "pide el precio", JSON.stringify(after));
  const withoutDate = await api(`/api/pipeline/leads/${lead?.leadId}`, { method: "PATCH", body: JSON.stringify({ followUpOn: null, followUpNote: null }) });
  ok("«Sin fecha» quita el seguimiento (AC6)", withoutDate.res.ok && withoutDate.json?.lead?.followUpOn === null);
}

/**
 * 030 — Importar contactos (tests/e2e/us-import-contacts.md): un CSV por la API, el
 * `.xlsx` de las pruebas y el diálogo a 360 px.
 */
async function importChecks() {
  console.log("\n== 030: importar contactos ==");
  const RUN = Date.now().toString().slice(-5);
  const { readFileSync } = await import("node:fs");
  const upload = (route, file, nameValue, fields = {}) => {
    const form = new FormData();
    form.set("file", new Blob([file]), nameValue);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return fetch(`${BASE}${route}`, { method: "POST", headers: { origin: BASE, cookie }, body: form }).then(async (res) => ({ res, json: await res.json().catch(() => null) }));
  };
  const csv = `Nombre;Teléfono;Notas\nImport Uno ${RUN};9870${RUN}1;de la feria\nImport Dos ${RUN};9870${RUN}2;\nRepetido ${RUN};+51 9870${RUN}1;\nMalo ${RUN};12;\n`;

  const badValue = await upload("/api/contacts/import/preview", "x", "lista.xls");
  ok("un .xls se rechaza con su motivo (AC1)", badValue.res.status === 422 && /\.xlsx o \.csv/.test(badValue.json?.error?.message ?? ""), JSON.stringify(badValue.json));

  const view = await upload("/api/contacts/import/preview", csv, "lista.csv", { countryCode: "51" });
  ok("la vista previa adivina las columnas (AC2)", view.res.ok && view.json?.mapping?.name === 0 && view.json?.mapping?.phone === 1 && view.json?.mapping?.notes === 2, JSON.stringify(view.json?.mapping));
  ok("…y cuenta lo que entra y lo que no (AC2, AC3)", JSON.stringify(view.json?.counts) === JSON.stringify({ ok: 2, exists: 0, duplicate: 1, invalid_phone: 1 }), JSON.stringify(view.json?.counts));
  ok("…sin guardar nada (D6)", !((await api(`/api/contacts?q=${encodeURIComponent(`Import Uno ${RUN}`)}`)).json?.contacts ?? []).length);

  const done = await upload("/api/contacts/import", csv, "lista.csv", { countryCode: "51" });
  ok("importa los nuevos (AC4)", done.res.ok && done.json?.created === 2, JSON.stringify(done.json));
  ok("…con el detalle de lo que no entró", JSON.stringify(done.json?.skipped?.map((s) => s.status)) === '["duplicate","invalid_phone"]');
  const board = (await api("/api/pipeline/board")).json?.leads ?? [];
  ok("cada importado tiene su lead en el Pipeline (AC4)", [`Import Uno ${RUN}`, `Import Dos ${RUN}`].every((n) => board.some((l) => l.contact.name === n)));
  const again = await upload("/api/contacts/import", csv, "lista.csv", { countryCode: "51" });
  ok("repetir la importación no crea nada (AC4)", again.json?.created === 0 && again.json?.counts?.ok === 0, JSON.stringify(again.json?.counts));

  const xlsx = await upload("/api/contacts/import/preview", readFileSync("tests/fixtures/contacts.xlsx"), "contacts.xlsx", { countryCode: "51" });
  ok("lee un .xlsx (AC1)", xlsx.res.ok && xlsx.json?.totalRows === 3 && xlsx.json?.sample?.[0]?.name === "María José Ñahui", JSON.stringify(xlsx.json?.sample?.[0]));

  // El diálogo en el teléfono.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/contacts`);
    await page.getByRole("button", { name: "Importar" }).click();
    await page.getByLabel("Archivo a importar").setInputFiles({
      name: "telefono.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`Cliente,Celular\nDesde el teléfono ${RUN},9871${RUN}\n`),
    });
    const button = page.getByRole("button", { name: "Importar 1" });
    await button.waitFor({ timeout: 15000 }).catch(() => {});
    ok("el diálogo muestra la vista previa (AC2)", await button.isVisible().catch(() => false));
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok("el diálogo a 360 px sin scroll horizontal (AC6)", !overflows);
    await button.click();
    const imported = await page
      .getByTestId("import-result")
      .getByText("1 contacto importado")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    ok("…e importa desde el teléfono", imported);
  } finally {
    await browser.close();
  }
}

/**
 * 031 — La IA responde solo fuera del horario de atención
 * (tests/e2e/us-ai-after-hours.md). Con el ai-mock: un horario que cubre
 * todo el día deja callada a la IA; sin horario (sin atención) contesta.
 */
async function attentionChecks() {
  console.log("\n== 031: la IA solo fuera de horario ==");
  const RUN = Date.now().toString().slice(-6);
  const wholeDay = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "24:00" }]]));

  const badValue = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ attentionHours: { mon: [{ start: "18:00", end: "09:00" }] } }) });
  ok("un horario al revés se rechaza (AC1, 422)", badValue.res.status === 422, `status=${badValue.res.status}`);
  const badZone = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ attentionTimezone: "Marte/Olympus" }) });
  ok("una zona inventada se rechaza (AC1, 422)", badZone.res.status === 422, `status=${badZone.res.status}`);

  const before = (await api("/api/agent/profile")).json;
  ok("por defecto la IA responde siempre (AC3)", before?.profile?.replyMode === "always" && Array.isArray(before?.profile?.attentionHours?.mon));

  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, replyMode: "outside_hours", attentionHours: wholeDay, attentionTimezone: "America/Lima" }),
  });
  const now = (await api("/api/agent/profile")).json;
  ok("con atención todo el día, ahora es horario de atención (AC1)", now?.attentionNow === true && now?.profile?.replyMode === "outside_hours");

  const write = (n) =>
    api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN, from: `5214631${RUN}${n}`, name: `Horario ${n} ${RUN}`, text: "hola, ¿cuánto cuesta?", waMessageId: `wamid.e2e.031.${RUN}.${n}` }),
    });
  const convDe = async (n) => ((await api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact.name === `Horario ${n} ${RUN}`);
  const answeredIa = async (n) => {
    const conv = await convDe(n);
    if (!conv) return false;
    const msgs = (await api(`/api/conversations/${conv.id}/messages`)).json?.messages ?? [];
    return msgs.some((m) => m.direction === "out" && m.origin === "ai");
  };

  await write(1);
  const answeredDuringHours = await until(() => answeredIa(1), 15000);
  ok("dentro del horario la IA no contesta (AC2)", !answeredDuringHours);
  const conv1 = await convDe(1);
  ok("…y la conversación no queda traspasada (D3)", Boolean(conv1) && !conv1.handoffAt, JSON.stringify({ handoffAt: conv1?.handoffAt }));

  // AC4 — El Laboratorio ignora el horario: con atención todo el día, una
  // corrida igual termina con puntaje (la IA contestó a los clientes simulados).
  const run = await api("/api/lab/runs", { method: "POST" });
  if (run.res.ok) {
    const id = run.json?.runId ?? run.json?.id;
    let final = null;
    await until(
      async () => {
        const r = (await api(`/api/lab/runs/${id}`)).json;
        final = r?.run ?? r;
        return final?.status && final.status !== "running";
      },
      180000,
      1000
    );
    ok("en el Laboratorio la IA contesta aunque sea horario de atención (AC4)", final?.status === "done" && final?.score !== null, JSON.stringify({ status: final?.status, score: final?.score }));
  } else {
    ok("en el Laboratorio la IA contesta aunque sea horario de atención (AC4)", false, `no se pudo iniciar la corrida: ${run.res.status}`);
  }

  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ attentionHours: {} }) });
  ok("sin horario de atención, ahora no es horario (AC1)", (await api("/api/agent/profile")).json?.attentionNow === false);
  await write(2);
  ok("fuera del horario la IA contesta (AC2)", await until(() => answeredIa(2), 25000));

  // La pantalla en el teléfono.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/agent`);
    const status = await page.getByTestId("attention-now").textContent({ timeout: 15000 }).catch(() => "");
    ok("Agente dice qué pasa ahora (AC5)", /fuera del horario de atención: contesta la IA/.test(status ?? ""), String(status));
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok("Agente a 360 px sin scroll horizontal (AC5)", !overflows);
  } finally {
    await browser.close();
  }

  // Deja todo como estaba para lo que siga.
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: false, replyMode: "always", attentionHours: before?.profile?.attentionHours ?? {} }) });
}

/** 1000 — «Acerca de» (tests/e2e/us-about.md). */
async function aboutChecks() {
  console.log("\n== 1000: acerca de ==");
  const health = (await api("/api/health")).json;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/inbox`);
    await page.getByRole("button", { name: /menú/i }).first().click().catch(() => {});
    const link = page.getByRole("link", { name: /^Acerca de/ });
    await link.first().click();
    await page.waitForURL(/\/about/, { timeout: 15000 }).catch(() => {});
    ok("la versión de la barra lateral lleva a «Acerca de» (AC1)", new URL(page.url()).pathname === "/about", page.url());
    const version = (await page.getByTestId("about-version").textContent({ timeout: 15000 }).catch(() => "")) ?? "";
    ok("muestra la versión de la app (AC2)", Boolean(health?.version) && version.includes(health.version), version);
    const modules = (await page.getByTestId("about-features").textContent()) ?? "";
    const agenda = health?.features?.agenda ? "Encendida" : "Apagada";
    ok("dice qué módulos están encendidos, como /api/health (AC3)", modules.includes("WhatsApp") && modules.includes(`Agenda y citas${agenda}`), modules);
    ok("el plan aparece solo con el servicio central encendido (AC4)", (await page.getByTestId("about-plan").count()) === (health?.features?.central ? 1 : 0) || health?.features?.central === true);
    await page.getByText(/Ver la licencia MIT/).click();
    ok("muestra la licencia MIT completa y los créditos (AC5)", (await page.getByTestId("about-license").textContent())?.includes("Permission is hereby granted") && (await page.content()).includes("Kevin Belier"));
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    ok("«Acerca de» a 360 px sin scroll horizontal (AC6)", !overflows);
    ok("…y sin secretos (AC6)", !/into_live_[0-9A-Za-z]{32}/.test(await page.content()));
  } finally {
    await browser.close();
  }
}


/** 1003 — Mostrar u ocultar la contraseña en «Entrar» (sin sesión, a 360 px). */
async function passwordToggleChecks() {
  console.log("\n== 1003: mostrar u ocultar la contraseña ==");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await page.goto(`${BASE}/login`);
    const field = page.locator("#password");
    await field.fill("una-clave-de-prueba");
    const toggle = page.getByRole("button", { name: "Mostrar contraseña" });
    ok("empieza oculta, con el botón «Mostrar contraseña» (AC1, AC2)", (await field.getAttribute("type")) === "password" && (await toggle.count()) === 1);
    await toggle.click();
    ok("al tocarlo se ve como texto y el botón dice «Ocultar contraseña» (AC1, AC2)",
      (await field.getAttribute("type")) === "text" && (await page.getByRole("button", { name: "Ocultar contraseña" }).getAttribute("aria-pressed")) === "true");
    ok("tocarlo no envía el formulario (AC2)", new URL(page.url()).pathname === "/login" && (await field.inputValue()) === "una-clave-de-prueba");
    await page.getByRole("button", { name: "Ocultar contraseña" }).click();
    ok("al volver a tocarlo se oculta de nuevo (AC1)", (await field.getAttribute("type")) === "password");
    const box = await page.getByTestId("password-toggle").boundingBox();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok("a 360 px sin scroll horizontal y con un botón de 36 px (AC3)", overflow <= 0 && (box?.width ?? 0) >= 36 && (box?.height ?? 0) >= 36, `overflow=${overflow} botón=${box?.width}x${box?.height}`);
  } finally {
    await browser.close();
  }
}

/** 1004 — «Ajustes → Sistema → Salud», con la sesión del propietario, a 360 px. */
async function healthPageChecks() {
  console.log("\n== 1004: salud del CRM ==");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
    const host = new URL(BASE).hostname;
    await page.context().addCookies(
      cookie.split("; ").filter(Boolean).map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
      })
    );
    await page.goto(`${BASE}/settings/branding`);
    await page.getByRole("link", { name: "Salud" }).first().click();
    await page.waitForURL(/\/settings\/health/, { timeout: 15000 }).catch(() => {});
    ok("Ajustes → Sistema → Salud abre la página (AC1)", new URL(page.url()).pathname === "/settings/health", page.url());
    const status = async (id) => page.getByTestId(`health-${id}`).getAttribute("data-status", { timeout: 15000 }).catch(() => null);
    ok("la base de datos responde (AC1)", (await status("database")) === "ok", (await page.getByTestId("health-database").textContent().catch(() => "")) ?? "");
    ok("sin migraciones pendientes (AC1)", (await status("migrations")) === "ok");
    ok("MEDIA_DIR se puede escribir (AC1)", (await status("media")) === "ok");
    ok("WhatsApp: el token del número conectado responde (AC1)", (await status("whatsapp")) === "ok", (await page.getByTestId("health-whatsapp").textContent()) ?? "");
    ok("IA, cerebro externo y central tienen su fila (AC1)",
      (await page.getByTestId("health-ai").count()) === 1 && (await page.getByTestId("health-brain").count()) === 1 && (await page.getByTestId("health-central").count()) === 1);
    ok("arriba, el resumen y la hora de la verificación (AC2)", /Verificado el/.test((await page.getByTestId("health-summary").textContent()) ?? ""));
    const html = await page.content();
    ok("no muestra la URL de la base ni tokens (AC3)", !/postgres(ql)?:\/\//.test(html) && !html.includes(process.env.OPENROUTER_API_TOKEN ?? "sin-token-en-este-entorno") && !html.includes(process.env.BOT_API_KEY ?? "sin-llave"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok("a 360 px sin scroll horizontal (AC5)", overflow <= 0, `overflow=${overflow}`);
    await page.getByTestId("health-recheck").click();
    await page.waitForLoadState();
    ok("«Verificar de nuevo» repite los chequeos (AC2)", (await status("database")) === "ok");
  } finally {
    await browser.close();
  }
}
