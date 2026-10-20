import { randomUUID } from "crypto";
import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { publicar } from "@backend/realtime";
import { cifrar, descifrar, enmascararTelefono, hashTelefono } from "@backend/crypto";
import { moduloActivo } from "@backend/modulos";
import { enviarAviso } from "@backend/notificaciones";
import { contar, observar } from "@backend/metricas";
import { log } from "@backend/log";
import { fechaLocalISO, minutosDe, partesLocales, fechaADate } from "@backend/fechas";
import { transicion, textoSlots, type Contexto, type Efecto, type EstadoBot, type Lectura, type Paso } from "@backend/bot/fsm";
import { motivoDescarte, type MensajeEntrante } from "@backend/bot/adaptadores";
import type { Prisma } from "@backend/generated/prisma/client";

/** M4 · Orquestador del chatbot (§6.1): resolver local, idempotencia, candado por teléfono, FSM, efectos y salida. */

const EXPIRA_MIN = 15;
const MAX_MSG_MIN = Number(process.env.BOT_MAX_MSG_MIN ?? 20);

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** RF-M4-02: el local se resuelve por el canal (sesión OpenWA o phone_number_id), nunca "el primero" (D1). */
export async function resolverCanal(proveedor: string, canalId: string) {
  const exacto = await prisma.canalWhatsapp.findUnique({ where: { proveedor_identificador: { proveedor, identificador: canalId } } });
  if (exacto) return exacto;
  // Con una sola sesión OpenWA configurada por entorno, se acepta el canal openwa único del sistema
  const canales = await prisma.canalWhatsapp.findMany({ where: { proveedor, botActivo: true } });
  return canales.length === 1 ? canales[0] : null;
}

async function lectura(localId: number, telefonoHash: string, consentimientoPrevio: boolean, ctx: Contexto, bienvenida: string | null): Promise<Lectura> {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId }, include: { horarios: { where: { activo: true }, orderBy: { diaSemana: "asc" } } } });
  const { localAbierto } = await import("@backend/operacion");
  const abierto = await localAbierto(localId, local.zonaHoraria);
  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria));
  const colas = await prisma.cola.findMany({ where: { localId, activa: true }, orderBy: { orden: "asc" } });
  const { tiempoEstimado } = await import("@backend/turnos");
  const colasAbiertas = abierto.abierto
    ? await Promise.all(
        colas.map(async (c) => {
          const enEspera = await prisma.turno.count({ where: { colaId: c.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] } } });
          return { id: c.id, nombre: c.nombre, enEspera, esperaMin: Math.ceil((await tiempoEstimado(c.id, enEspera + 1)) / 60) };
        }),
      )
    : [];
  const turnos = await prisma.turno.findMany({ where: { localId, estado: { in: ["EMITIDO", "AVISADO", "LLAMADO"] }, cliente: { telefonoHash } }, include: { cola: true }, orderBy: { id: "asc" } });
  const turnosActivos = await Promise.all(
    turnos.map(async (t) => {
      const p = await prisma.$queryRaw<{ p: number }[]>`SELECT posicion_turno(${t.id}::int) AS p`;
      const pos = Number(p[0]?.p ?? 1);
      return { token: t.token, codigo: t.codigo, cola: t.cola.nombre, posicion: pos, esperaMin: t.estado === "LLAMADO" ? 0 : Math.ceil((await tiempoEstimado(t.colaId, pos)) / 60), estado: t.estado };
    }),
  );
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const horarioTexto = local.horarios.length
    ? `🕒 Horario de atención:\n${local.horarios.map((h) => `${DIAS[h.diaSemana]} ${h.apertura}–${h.cierre}`).join("\n")}${abierto.abierto ? "\nAhora estamos *abiertos*." : `\n${abierto.mensaje ?? ""}`}`
    : "Atendemos todo el día.";
  const M1 = await moduloActivo(localId, "M1");
  const M3 = await moduloActivo(localId, "M3");
  const categorias = M1 ? await prisma.categoriaPrioridad.findMany({ where: { localId, activa: true, visibleCliente: true, codigo: { not: "GENERAL" } }, orderBy: { orden: "asc" }, select: { codigo: true, nombre: true } }) : [];
  let colasCita: { id: number; nombre: string }[] = [];
  let fechasDisponibles: string[] = [];
  let slots: { id: number; hora: string }[] = [];
  if (M3) {
    const citas = await import("@backend/citas/service");
    colasCita = await citas.colasConCitas(localId);
    if (colasCita.length) {
      const disp = await citas.disponibilidad(local.slug, colasCita[0].id, 7).catch(() => []);
      fechasDisponibles = disp.filter((d) => d.libres > 0).map((d) => d.fecha).slice(0, 7);
      if (ctx.fecha && ctx.colaId) slots = (await citas.slotsDelDia(local.slug, ctx.colaId, ctx.fecha).catch(() => [])).filter((s) => s.disponible).slice(0, 9).map((s) => ({ id: s.id, hora: s.hora }));
    }
  }
  return { local: local.nombreComercial, colasAbiertas, turnosActivos, horarioTexto, categorias, colasCita, fechasDisponibles, slots, modulos: { M1, M3 }, consentimientoPrevio, bienvenida };
}

async function guardarMensaje(conversacionId: string, direccion: "ENTRANTE" | "SALIENTE", texto: string, extra: { proveedorMsgId?: string | null; autor?: string; intencion?: string; estadoBot?: string } = {}) {
  await prisma.mensajeBot.create({
    data: { conversacionId, direccion, textoCifrado: cifrar(texto), proveedorMsgId: extra.proveedorMsgId ?? null, autor: extra.autor ?? (direccion === "SALIENTE" ? "bot" : null), intencion: extra.intencion ?? null, estadoBot: extra.estadoBot ?? null, estado: direccion === "ENTRANTE" ? "RECIBIDO" : "PENDIENTE" },
  });
}

/** Salida con *throttling* (RN-M4-05): ≥ 1,2 s entre mensajes de la misma conversación. */
async function enviar(localId: number, telefono: string, textos: string[], conversacionId: string, autor = "bot") {
  for (let i = 0; i < textos.length; i++) {
    if (i > 0 && process.env.NODE_ENV !== "test") await new Promise((r) => setTimeout(r, 1200));
    await guardarMensaje(conversacionId, "SALIENTE", textos[i], { autor });
    await enviarAviso({ localId, telefonoE164: telefono, plantilla: "bot", texto: textos[i], cuentaCupo: false }).catch((e) => log.warn("bot: envío falló", { modulo: "M4", error: String(e) }));
  }
}

/** Ejecuta los efectos de la FSM; si fallan, vuelve a la FSM con RESULTADO. */
async function ejecutarEfectos(paso: Paso, conv: { id: string; localId: number; telefono: string; telefonoHash: string; consentimiento: boolean }, l: Lectura, bienvenida: string | null): Promise<Paso> {
  let actual = paso;
  for (const ef of paso.efectos as Efecto[]) {
    if (ef.tipo === "REGISTRAR_CONSENTIMIENTO") {
      await prisma.conversacionBot.update({ where: { id: conv.id }, data: { consentimientoAt: new Date() } });
      conv.consentimiento = true;
    }
    if (ef.tipo === "HANDOFF") {
      await prisma.conversacionBot.update({ where: { id: conv.id }, data: { handoff: true, handoffAt: new Date() } });
      publicar({ tipo: "bot:handoff", localId: conv.localId, conversacionId: conv.id, activo: true });
      contar("m4_handoff_total");
      const canal = await prisma.canalWhatsapp.findFirst({ where: { localId: conv.localId } });
      if (!dentroAtencionHumana(canal?.atencionHumana)) {
        actual = { ...actual, respuestas: [...actual.respuestas, "Un asesor te escribirá en horario de atención."] };
      }
    }
    if (ef.tipo === "EMITIR_TURNO") {
      try {
        const { emitirTurno } = await import("@backend/turnos");
        const t = await emitirTurno({ colaId: ef.colaId, nombre: ef.nombre ?? null, telefono: conv.telefono, consentimiento: conv.consentimiento, canal: "WHATSAPP", categoriaCodigo: ef.categoria ?? null, origenCategoria: "CLIENTE" });
        contar("m4_turnos_emitidos_total");
        const rango = t.prediccion ? ` (${Math.max(1, Math.round(t.prediccion.loSeg / 60))}–${Math.max(1, Math.round(t.prediccion.hiSeg / 60))})` : "";
        actual = transicion(actual.estado, { ...actual.ctx, turnoToken: t.token }, { tipo: "RESULTADO", ok: true, mensaje: `✅ Listo. Tu turno es *${t.codigo}*.\nPosición: ${t.posicion} · Espera: ~${Math.max(1, Math.ceil(t.tiempoEstimadoSeg / 60))} min${rango}\nSigue tu turno: ${appUrl()}/t/${t.token}` }, l);
      } catch (e) {
        const err = e as { codigo?: string; message?: string };
        actual = transicion(actual.estado, actual.ctx, { tipo: "RESULTADO", ok: false, codigo: err.codigo, mensaje: err.message }, l);
      }
    }
    if (ef.tipo === "CANCELAR_TURNO") {
      // Solo turnos del propio teléfono (§11)
      const t = await prisma.turno.findFirst({ where: { token: ef.token, localId: conv.localId, cliente: { telefonoHash: conv.telefonoHash } } });
      if (!t) {
        actual = { ...actual, respuestas: ["No encontré ese turno."] };
        continue;
      }
      try {
        const { cancelarTurno } = await import("@backend/turnos");
        await cancelarTurno(t.token);
        actual = { ...actual, respuestas: [`Cancelé tu turno *${t.codigo}*.`, ...actual.respuestas] };
      } catch (e) {
        actual = { ...actual, respuestas: [e instanceof Error ? e.message : "No pude cancelar el turno."] };
      }
    }
    if (ef.tipo === "CARGAR_SLOTS") {
      const l2 = await lectura(conv.localId, conv.telefonoHash, conv.consentimiento, actual.ctx, bienvenida);
      actual = { ...actual, respuestas: [textoSlots(l2.slots)] };
    }
    if (ef.tipo === "RESERVAR_CITA") {
      try {
        const { reservar } = await import("@backend/citas/service");
        const c = await reservar({ localId: conv.localId, colaId: ef.colaId, slotId: ef.slotId, nombre: ef.nombre ?? "Cliente WhatsApp", telefono: conv.telefono, consentimiento: true, canal: "BOT" });
        actual = { estado: "MENU", ctx: { intentos: 0 }, respuestas: [`📅 Cita reservada para el ${c.inicioLocal}. Código de check-in: *${c.codigoCheckin}*. Detalles: ${c.urlQr}`], efectos: [], intencion: "SI" };
      } catch (e) {
        const err = e as { codigo?: string; message?: string };
        actual = transicion(actual.estado, actual.ctx, { tipo: "RESULTADO", ok: false, codigo: err.codigo, mensaje: err.message }, l);
      }
    }
  }
  return actual;
}

function dentroAtencionHumana(cfg: unknown, ahora = new Date()) {
  const c = cfg as { dias?: number[]; desde?: string; hasta?: string } | null | undefined;
  if (!c?.desde || !c?.hasta) return true;
  const p = partesLocales("America/Lima", ahora);
  const min = p.hora * 60 + p.minuto;
  return (c.dias ?? [1, 2, 3, 4, 5]).includes(p.diaSemana) && min >= minutosDe(c.desde) && min < minutosDe(c.hasta);
}

/**
 * Pipeline completo de un mensaje entrante. Devuelve el resultado para pruebas.
 * Idempotencia por `proveedor + mensajeId` (RN-M4-01) y candado consultivo por (local, teléfono) (RNF-M4-02).
 */
export async function procesarEntrante(m: MensajeEntrante, ahora = new Date()) {
  const t0 = performance.now();
  const descarte = motivoDescarte(m, ahora.getTime());
  if (descarte) return { ignorado: descarte };
  contar("m4_mensajes_entrantes_total", { proveedor: m.proveedor });

  const ins = await prisma.$executeRaw`INSERT INTO evento_bot_procesado (proveedor, mensaje_id) VALUES (${m.proveedor}, ${m.mensajeId}) ON CONFLICT DO NOTHING`;
  if (Number(ins) === 0) {
    contar("m4_duplicados_total");
    return { ignorado: "DUPLICADO" };
  }
  const canal = await resolverCanal(m.proveedor, m.canalId);
  if (!canal || !canal.botActivo) return { ignorado: "SIN_CANAL" };
  if (!(await moduloActivo(canal.localId, "M4"))) return { ignorado: "MODULO_INACTIVO" };

  // RN-M4-04: límite de entrada por teléfono
  const telefonoHash = hashTelefono(m.desde);
  const ventana = new Date(Math.floor(ahora.getTime() / 60000) * 60000);
  const rl = await prisma.$queryRaw<{ contador: number }[]>`
    INSERT INTO rate_limit (clave, ventana, contador) VALUES (${`bot:${canal.localId}:${telefonoHash}`}, ${ventana}, 1)
    ON CONFLICT (clave, ventana) DO UPDATE SET contador = rate_limit.contador + 1 RETURNING contador`;
  if ((rl[0]?.contador ?? 0) > MAX_MSG_MIN) {
    contar("m4_limite_total");
    return { ignorado: "LIMITE" };
  }

  const salida = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${canal.localId}:${telefonoHash}`}, 0))`;
      let conv = await tx.conversacionBot.findUnique({ where: { localId_telefonoHash: { localId: canal.localId, telefonoHash } } });
      if (!conv) {
        conv = await tx.conversacionBot.create({ data: { id: randomUUID(), localId: canal.localId, telefonoHash, telefonoCifrado: cifrar(m.desde), expiraAt: new Date(ahora.getTime() + EXPIRA_MIN * 60000) } });
      }
      if (conv.silenciadaHasta && conv.silenciadaHasta > ahora) return null;
      let estado = conv.estado as EstadoBot;
      // RF-M4-03: expira a los 15 min (salvo en atención humana)
      if (!conv.handoff && conv.expiraAt < ahora) estado = "CERRADA";
      return { conv, estado };
    },
    { timeout: 20_000 },
  );
  if (!salida) return { ignorado: "SILENCIADA" };
  const { conv } = salida;
  let estado = salida.estado;
  if (conv.handoff) estado = "HANDOFF";

  await guardarMensaje(conv.id, "ENTRANTE", m.tipo === "texto" ? m.texto : "[multimedia]", { proveedorMsgId: m.mensajeId, estadoBot: estado });
  publicar({ tipo: "bot:mensaje", localId: conv.localId, conversacionId: conv.id });

  if (m.tipo !== "texto") {
    if (estado !== "HANDOFF") await enviar(conv.localId, m.desde, ["Por ahora solo entiendo mensajes de texto. Escribe *menu*."], conv.id);
    return { conversacionId: conv.id, estado };
  }

  const ctx = (conv.contexto ?? { intentos: 0 }) as unknown as Contexto;
  const l = await lectura(conv.localId, telefonoHash, !!conv.consentimientoAt, ctx, canal.bienvenida);
  let paso = transicion(estado, { ...ctx, intentos: conv.intentosInvalidos }, { tipo: "TEXTO", texto: m.texto }, l);
  if (paso.intencion === "OTRO") contar("m4_no_entendido_total");
  paso = await ejecutarEfectos(paso, { id: conv.id, localId: conv.localId, telefono: m.desde, telefonoHash, consentimiento: !!conv.consentimientoAt }, l, canal.bienvenida);

  const salirHandoff = estado === "HANDOFF" && paso.estado !== "HANDOFF";
  await prisma.conversacionBot.update({
    where: { id: conv.id },
    data: {
      estado: paso.estado,
      contexto: paso.ctx as unknown as Prisma.InputJsonValue,
      intentosInvalidos: paso.ctx.intentos ?? 0,
      ultimoMensajeAt: ahora,
      expiraAt: new Date(ahora.getTime() + EXPIRA_MIN * 60000),
      ...(salirHandoff ? { handoff: false, handoffAt: null } : {}),
    },
  });
  await prisma.mensajeBot.updateMany({ where: { conversacionId: conv.id, proveedorMsgId: m.mensajeId }, data: { intencion: paso.intencion } });
  if (paso.respuestas.length) await enviar(conv.localId, m.desde, paso.respuestas, conv.id);
  observar("m4_proceso_ms", performance.now() - t0);
  return { conversacionId: conv.id, estado: paso.estado, respuestas: paso.respuestas };
}

// ---------------------------------------------------------------------------
// Bandeja, handoff y administración (RF-M4-09, §7)
// ---------------------------------------------------------------------------
export async function bandeja(localId: number, filtro: { handoff?: boolean; cursor?: string | null } = {}) {
  const convs = await prisma.conversacionBot.findMany({
    where: { localId, ...(filtro.handoff !== undefined ? { handoff: filtro.handoff } : {}), ...(filtro.cursor ? { ultimoMensajeAt: { lt: new Date(filtro.cursor) } } : {}) },
    orderBy: { ultimoMensajeAt: "desc" },
    take: 40,
    include: { mensajes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return {
    items: convs.map((c) => {
      const tel = descifrar(c.telefonoCifrado);
      const ultimo = c.mensajes[0];
      return { id: c.id, telefono: tel ? enmascararTelefono(tel) : "***", estado: c.estado, handoff: c.handoff, handoffAt: c.handoffAt, ultimoMensajeAt: c.ultimoMensajeAt, ultimo: ultimo ? (descifrar(ultimo.textoCifrado) ?? "").slice(0, 120) : null, direccionUltimo: ultimo?.direccion ?? null };
    }),
    cursor: convs.length === 40 ? convs[convs.length - 1].ultimoMensajeAt.toISOString() : null,
  };
}

async function conversacionDelLocal(localId: number, id: string) {
  const c = await prisma.conversacionBot.findFirst({ where: { id, localId } });
  if (!c) throw new ErrorNegocio("M4_CONVERSACION_NO_ENCONTRADA", "La conversación no existe", 404);
  return c;
}

export async function mensajes(localId: number, id: string) {
  await conversacionDelLocal(localId, id);
  const ms = await prisma.mensajeBot.findMany({ where: { conversacionId: id }, orderBy: { createdAt: "asc" }, take: 200 });
  return ms.map((m) => ({ id: String(m.id), direccion: m.direccion, texto: descifrar(m.textoCifrado) ?? "", autor: m.autor, intencion: m.intencion, createdAt: m.createdAt }));
}

export async function responderComoPersona(localId: number, id: string, texto: string, usuarioId: number) {
  const c = await conversacionDelLocal(localId, id);
  if (!c.handoff) throw new ErrorNegocio("M4_NO_EN_HANDOFF", "La conversación no está en atención humana", 409);
  const limpio = texto.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 1000);
  if (!limpio) throw new ErrorNegocio("M4_TEXTO_VACIO", "Escribe un mensaje", 422);
  const tel = descifrar(c.telefonoCifrado);
  if (!tel) throw new ErrorNegocio("M4_CONVERSACION_NO_ENCONTRADA", "La conversación ya no tiene teléfono", 404);
  await enviar(localId, tel, [limpio], c.id, String(usuarioId));
  await prisma.conversacionBot.update({ where: { id: c.id }, data: { ultimoMensajeAt: new Date(), handoffAt: new Date() } });
  publicar({ tipo: "bot:mensaje", localId, conversacionId: c.id });
  return { enviado: true };
}

export async function cambiarHandoff(localId: number, id: string, activo: boolean) {
  const c = await conversacionDelLocal(localId, id);
  await prisma.conversacionBot.update({ where: { id: c.id }, data: activo ? { handoff: true, handoffAt: new Date(), estado: "HANDOFF" } : { handoff: false, handoffAt: null, estado: "MENU", contexto: { intentos: 0 } } });
  if (!activo) {
    const tel = descifrar(c.telefonoCifrado);
    if (tel) await enviar(localId, tel, ["Te devolvemos al asistente automático. Escribe *menu* para ver las opciones."], c.id);
  }
  publicar({ tipo: "bot:handoff", localId, conversacionId: c.id, activo });
  return { handoff: activo };
}

/** POST /bot/probar: ejecuta la FSM sin enviar mensajes ni ejecutar efectos (RF-M4-11). */
export async function probar(localId: number, estado: EstadoBot | undefined, contexto: Contexto | undefined, texto: string) {
  const canal = await prisma.canalWhatsapp.findFirst({ where: { localId } });
  const l = await lectura(localId, "simulador", true, contexto ?? { intentos: 0 }, canal?.bienvenida ?? null);
  const p = transicion(estado ?? "INICIO", contexto ?? { intentos: 0 }, { tipo: "TEXTO", texto }, l);
  return { estado: p.estado, contexto: p.ctx, respuestas: p.respuestas, efectos: p.efectos, intencion: p.intencion };
}

export async function metricasBot(localId: number, dias = 7) {
  const desde = new Date(Date.now() - dias * 86400000);
  const convs = await prisma.conversacionBot.findMany({ where: { localId, createdAt: { gte: desde } }, select: { id: true, handoffAt: true } });
  const ids = convs.map((c) => c.id);
  const msgs = await prisma.mensajeBot.findMany({ where: { conversacionId: { in: ids }, createdAt: { gte: desde } }, select: { direccion: true, intencion: true, createdAt: true, conversacionId: true, estadoBot: true } });
  const entrantes = msgs.filter((m) => m.direccion === "ENTRANTE");
  const turnos = await prisma.turno.count({ where: { localId, canal: "WHATSAPP", emitidoAt: { gte: desde } } });
  const intenciones = new Map<string, number>();
  for (const m of entrantes) if (m.intencion) intenciones.set(m.intencion, (intenciones.get(m.intencion) ?? 0) + 1);
  const porDia = new Map<string, number>();
  for (const m of entrantes) {
    const d = m.createdAt.toISOString().slice(0, 10);
    porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }
  const embudo = ["MENU", "ELEGIR_COLA", "CONFIRMAR_TURNO"].map((e) => ({ estado: e, conversaciones: new Set(entrantes.filter((m) => m.estadoBot === e).map((m) => m.conversacionId)).size }));
  return {
    conversaciones: convs.length,
    mensajes: entrantes.length,
    turnosEmitidos: turnos,
    conversion: convs.length ? Math.round((turnos / convs.length) * 1000) / 10 : 0,
    noEntendido: entrantes.filter((m) => m.intencion === "OTRO").length,
    handoffs: convs.filter((c) => c.handoffAt).length,
    topIntenciones: [...intenciones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([intencion, n]) => ({ intencion, n })),
    porDia: [...porDia.entries()].sort().map(([dia, n]) => ({ dia, n })),
    embudo: [...embudo, { estado: "TURNO", conversaciones: turnos }],
  };
}

export async function configBot(localId: number) {
  let canal = await prisma.canalWhatsapp.findFirst({ where: { localId } });
  if (!canal) {
    const local = await prisma.local.findUniqueOrThrow({ where: { id: localId } });
    const proveedor = (process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase() === "meta" ? "meta" : "openwa";
    canal = await prisma.canalWhatsapp.create({ data: { localId, proveedor, identificador: proveedor === "openwa" ? (process.env.OPENWA_SESSION ?? `turnoya-${local.slug}`) : (process.env.WHATSAPP_PHONE_NUMBER_ID ?? `meta-${local.slug}`), botActivo: false } });
  }
  return canal;
}

export async function guardarConfigBot(localId: number, d: { proveedor?: string; identificador?: string; botActivo?: boolean; bienvenida?: string | null; atencionHumana?: { dias: number[]; desde: string; hasta: string } | null }) {
  const canal = await configBot(localId);
  try {
    return await prisma.canalWhatsapp.update({
      where: { id: canal.id },
      data: {
        ...(d.proveedor ? { proveedor: d.proveedor } : {}),
        ...(d.identificador ? { identificador: d.identificador } : {}),
        ...(d.botActivo !== undefined ? { botActivo: d.botActivo } : {}),
        ...(d.bienvenida !== undefined ? { bienvenida: d.bienvenida } : {}),
        ...(d.atencionHumana !== undefined ? { atencionHumana: (d.atencionHumana ?? undefined) as Prisma.InputJsonValue | undefined } : {}),
      },
    });
  } catch (e) {
    if (e instanceof Error && /Unique constraint/.test(e.message)) throw new ErrorNegocio("DUPLICADO", "Ese número/sesión ya está asignado a otro local", 409);
    throw e;
  }
}

/** Job cada 5 min: cierra conversaciones inactivas y devuelve al bot los handoff sin respuesta en 30 min. */
export async function jobExpirarSesiones(ahora = new Date()) {
  const cerradas = await prisma.conversacionBot.updateMany({ where: { handoff: false, expiraAt: { lt: ahora }, estado: { not: "CERRADA" } }, data: { estado: "CERRADA", contexto: { intentos: 0 } } });
  const devueltas = await prisma.conversacionBot.updateMany({ where: { handoff: true, handoffAt: { lt: new Date(ahora.getTime() - 30 * 60000) } }, data: { handoff: false, handoffAt: null, estado: "MENU" } });
  return { cerradas: cerradas.count, devueltas: devueltas.count };
}
