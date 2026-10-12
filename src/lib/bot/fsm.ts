import { intencion, normalizar as normalizarSimple, type Intencion } from "@/lib/bot/intencion";

/**
 * M4 · Máquina de estados pura del chatbot (docs/modulos/M4-chatbot-whatsapp.md §6.3b–6.4).
 * Sin BD ni red: recibe la "lectura" (colas, turnos activos, horario…) y devuelve estado, respuestas y efectos.
 */

export type EstadoBot =
  | "INICIO" | "MENU" | "ELEGIR_COLA" | "ELEGIR_CATEGORIA" | "PEDIR_NOMBRE" | "PEDIR_CONSENTIMIENTO" | "CONFIRMAR_TURNO"
  | "ELEGIR_TURNO_ACTIVO" | "SEGUIMIENTO" | "CONFIRMAR_CANCELAR" | "ELEGIR_FECHA" | "ELEGIR_HORA" | "CONFIRMAR_CITA" | "HANDOFF" | "CERRADA";

export type Entrada =
  | { tipo: "TEXTO"; texto: string }
  | { tipo: "TIMEOUT" }
  | { tipo: "RESULTADO"; ok: boolean; codigo?: string; mensaje?: string };

export interface Contexto {
  colaId?: number;
  cola?: string;
  categoria?: string;
  nombre?: string;
  nombreOmitido?: boolean;
  consentimiento?: boolean;
  turnoToken?: string;
  proposito?: "POSICION" | "CANCELAR";
  fecha?: string;
  slotId?: number;
  hora?: string;
  intentos: number;
}

export interface ColaInfo { id: number; nombre: string; enEspera: number; esperaMin: number | null }
export interface TurnoInfo { token: string; codigo: string; cola: string; posicion: number; esperaMin: number | null; estado: string }
export interface Lectura {
  local: string;
  colasAbiertas: ColaInfo[];
  turnosActivos: TurnoInfo[];
  horarioTexto: string;
  categorias: { codigo: string; nombre: string }[];
  colasCita: { id: number; nombre: string }[];
  fechasDisponibles: string[];
  slots: { id: number; hora: string }[];
  modulos: { M1: boolean; M3: boolean };
  consentimientoPrevio: boolean;
  bienvenida?: string | null;
}

export type Efecto =
  | { tipo: "EMITIR_TURNO"; colaId: number; nombre?: string; categoria?: string }
  | { tipo: "CANCELAR_TURNO"; token: string }
  | { tipo: "RESERVAR_CITA"; colaId: number; slotId: number; nombre?: string }
  | { tipo: "HANDOFF" }
  | { tipo: "REGISTRAR_CONSENTIMIENTO" }
  | { tipo: "CARGAR_SLOTS"; colaId: number; fecha: string };

export interface Paso { estado: EstadoBot; ctx: Contexto; respuestas: string[]; efectos: Efecto[]; intencion: string }

const NUM = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const n = (i: number) => (i < 10 ? NUM[i] : `${i}.`);

export const MENSAJES = {
  menu: (l: Lectura) =>
    `${l.bienvenida?.trim() || `¡Hola! 👋 Soy el asistente de *${l.local}*.`} ¿Qué deseas hacer?\n${n(1)} Tomar turno\n${n(2)} Mi posición\n${n(3)} Cancelar mi turno\n${n(4)} Horarios${l.modulos.M3 ? `\n${n(5)} Agendar cita` : ""}\n${n(6)} Hablar con una persona`,
  noEntiendo: "No te entendí 🙈. Responde con un número del menú, o escribe *menu* o *asesor*.",
  consent: "Para avisarte por este chat cuando se acerque tu turno usaremos tu número solo para eso. ¿Aceptas? (*sí* / *no*)",
  handoff: "Te comunico con una persona del local. Te escribirá por aquí en breve. 🙋",
  ayuda: "Puedes escribir: *menu*, *posicion*, *cancelar*, *asesor* o *salir*.",
  despedida: "¡Hasta pronto! Escribe *hola* cuando quieras volver. 👋",
};

function listaColas(l: Lectura) {
  return `Elige el servicio:\n${l.colasAbiertas.map((c, i) => `${n(i + 1)} *${c.nombre}* · ${c.enEspera} en espera${c.esperaMin != null ? ` · ~${c.esperaMin} min` : ""}`).join("\n")}\n(Responde con el número, o *menu*)`;
}

function textoTurno(t: TurnoInfo) {
  if (t.estado === "LLAMADO") return `📣 Tu turno *${t.codigo}* (${t.cola}) está siendo llamado. ¡Acércate!`;
  return `Tu turno *${t.codigo}* (${t.cola}): posición ${t.posicion}${t.esperaMin != null ? ` · espera ~${t.esperaMin} min` : ""}.`;
}

function menu(ctx: Contexto, l: Lectura, extra: string[] = []): Paso {
  return { estado: "MENU", ctx: { intentos: 0 }, respuestas: [...extra, MENSAJES.menu(l)], efectos: [], intencion: "MENU" };
}

function invalido(estado: EstadoBot, ctx: Contexto, l: Lectura, repetir: string): Paso {
  const intentos = (ctx.intentos ?? 0) + 1;
  if (intentos >= 3) {
    // RF-M4-10: tras 3 entradas inválidas se ofrece menú y atención humana
    return { estado: "MENU", ctx: { intentos: 0 }, respuestas: ["Parece que no nos estamos entendiendo. Escribe *asesor* para hablar con una persona.", MENSAJES.menu(l)], efectos: [], intencion: "OTRO" };
  }
  return { estado, ctx: { ...ctx, intentos }, respuestas: [MENSAJES.noEntiendo, repetir], efectos: [], intencion: "OTRO" };
}

function pasoTomarTurno(ctx: Contexto, l: Lectura): Paso {
  if (!l.colasAbiertas.length) return menu(ctx, l, [`Ahora no hay servicios abiertos. ${l.horarioTexto}`]);
  return { estado: "ELEGIR_COLA", ctx: { intentos: 0 }, respuestas: [listaColas(l)], efectos: [], intencion: "TOMAR_TURNO" };
}

function pasoTurnoActivo(ctx: Contexto, l: Lectura, proposito: "POSICION" | "CANCELAR"): Paso {
  const ts = l.turnosActivos;
  if (!ts.length) return menu(ctx, l, ["No tienes un turno activo."]);
  if (ts.length > 1) {
    return { estado: "ELEGIR_TURNO_ACTIVO", ctx: { intentos: 0, proposito }, respuestas: [`Tienes ${ts.length} turnos:\n${ts.map((t, i) => `${n(i + 1)} *${t.codigo}* (${t.cola})`).join("\n")}\n¿Cuál?`], efectos: [], intencion: proposito };
  }
  return proposito === "POSICION" ? { estado: "SEGUIMIENTO", ctx: { intentos: 0, turnoToken: ts[0].token }, respuestas: [textoTurno(ts[0])], efectos: [], intencion: proposito } : confirmarCancelar(ts[0]);
}

function confirmarCancelar(t: TurnoInfo): Paso {
  return { estado: "CONFIRMAR_CANCELAR", ctx: { intentos: 0, turnoToken: t.token }, respuestas: [`¿Seguro que quieres cancelar el turno *${t.codigo}*? (*sí* / *no*)`], efectos: [], intencion: "CANCELAR" };
}

function siguienteTrasCola(ctx: Contexto, l: Lectura): Paso {
  if (l.modulos.M1 && l.categorias.length && !ctx.categoria) {
    return { estado: "ELEGIR_CATEGORIA", ctx, respuestas: [`¿Qué tipo de atención necesitas?\n${n(1)} General\n${l.categorias.map((c, i) => `${n(i + 2)} ${c.nombre}`).join("\n")}\n(Se verificará el documento en ventanilla)`], efectos: [], intencion: "NUMERO" };
  }
  if (!ctx.nombre && !ctx.nombreOmitido) return { estado: "PEDIR_NOMBRE", ctx, respuestas: ["¿Cuál es tu nombre? (o escribe *omitir*)"], efectos: [], intencion: "NUMERO" };
  if (!ctx.consentimiento && !l.consentimientoPrevio) return { estado: "PEDIR_CONSENTIMIENTO", ctx, respuestas: [MENSAJES.consent], efectos: [], intencion: "TEXTO" };
  return { estado: "CONFIRMAR_TURNO", ctx, respuestas: [`Vas a tomar turno en *${ctx.cola}*. ¿Confirmas? (*sí* / *no*)`], efectos: [], intencion: "TEXTO" };
}

export function transicion(estado: EstadoBot, ctxEntrada: Contexto, entrada: Entrada, l: Lectura): Paso {
  const ctx: Contexto = { ...ctxEntrada, intentos: ctxEntrada.intentos ?? 0 };

  if (entrada.tipo === "TIMEOUT") return { estado: "CERRADA", ctx: { intentos: 0 }, respuestas: [], efectos: [], intencion: "TIMEOUT" };

  if (entrada.tipo === "RESULTADO") {
    if (entrada.ok) return { estado: "SEGUIMIENTO", ctx: { intentos: 0, turnoToken: ctx.turnoToken }, respuestas: entrada.mensaje ? [entrada.mensaje] : [], efectos: [], intencion: "RESULTADO" };
    const amables: Record<string, string> = {
      TURNO_DUPLICADO: "Ya tienes un turno activo en ese servicio. Escribe *2* para ver tu posición.",
      LIMITE_PLAN: "Por hoy no podemos emitir más turnos por este medio. Acércate al mostrador.",
      COLA_INACTIVA: "Ese servicio ya no está disponible.",
      COLA_CERRADA: entrada.mensaje ?? "Ahora estamos cerrados.",
      M3_CLIENTE_BLOQUEADO: entrada.mensaje ?? "Tus reservas están bloqueadas por inasistencias.",
      M3_SLOT_LLENO: "Ese horario se acaba de llenar. Elige otro.",
    };
    return menu(ctx, l, [amables[entrada.codigo ?? ""] ?? entrada.mensaje ?? "No pude completar la operación."]);
  }

  const it: Intencion = intencion(entrada.texto);

  // En atención humana el bot calla (solo "menu" devuelve el control, RF-M4-09)
  if (estado === "HANDOFF") {
    if (normalizarSimple(entrada.texto) === "menu") return menu(ctx, l);
    return { estado: "HANDOFF", ctx, respuestas: [], efectos: [], intencion: it.tipo };
  }

  // Comandos globales (RF-M4-08)
  if (it.tipo === "MENU" || estado === "INICIO" || estado === "CERRADA") return { ...menu(ctx, l), intencion: it.tipo };
  if (it.tipo === "AYUDA") return { estado, ctx, respuestas: [MENSAJES.ayuda], efectos: [], intencion: "AYUDA" };
  if (it.tipo === "SALIR") return { estado: "CERRADA", ctx: { intentos: 0 }, respuestas: [MENSAJES.despedida], efectos: [], intencion: "SALIR" };
  if (it.tipo === "HUMANO") return { estado: "HANDOFF", ctx: { intentos: 0 }, respuestas: [MENSAJES.handoff], efectos: [{ tipo: "HANDOFF" }], intencion: "HUMANO" };
  if (it.tipo === "POSICION" && estado !== "PEDIR_NOMBRE") return pasoTurnoActivo(ctx, l, "POSICION");
  if (it.tipo === "CANCELAR" && !["CONFIRMAR_CANCELAR", "PEDIR_NOMBRE"].includes(estado)) return pasoTurnoActivo(ctx, l, "CANCELAR");

  switch (estado) {
    case "MENU":
    case "SEGUIMIENTO": {
      const op = it.tipo === "NUMERO" ? it.n : it.tipo === "TOMAR_TURNO" ? 1 : it.tipo === "HORARIOS" ? 4 : it.tipo === "CITA" ? 5 : -1;
      if (op === 1) return pasoTomarTurno(ctx, l);
      if (op === 2) return pasoTurnoActivo(ctx, l, "POSICION");
      if (op === 3) return pasoTurnoActivo(ctx, l, "CANCELAR");
      if (op === 4) return { estado: "MENU", ctx: { intentos: 0 }, respuestas: [l.horarioTexto], efectos: [], intencion: "HORARIOS" };
      if (op === 5 && l.modulos.M3) {
        if (!l.colasCita.length) return menu(ctx, l, ["Por ahora no hay servicios con cita."]);
        return { estado: "ELEGIR_FECHA", ctx: { intentos: 0, colaId: l.colasCita[0].id, cola: l.colasCita[0].nombre }, respuestas: [`Fechas con cupo para *${l.colasCita[0].nombre}*:\n${l.fechasDisponibles.map((f, i) => `${n(i + 1)} ${f}`).join("\n") || "(no hay fechas)"}`], efectos: [], intencion: "CITA" };
      }
      if (op === 6) return { estado: "HANDOFF", ctx: { intentos: 0 }, respuestas: [MENSAJES.handoff], efectos: [{ tipo: "HANDOFF" }], intencion: "HUMANO" };
      if (estado === "SEGUIMIENTO" && it.tipo === "SI") return menu(ctx, l);
      return invalido(estado, ctx, l, MENSAJES.menu(l));
    }
    case "ELEGIR_COLA": {
      const cola = it.tipo === "NUMERO" ? l.colasAbiertas[it.n - 1] : undefined;
      if (!cola) return invalido(estado, ctx, l, listaColas(l));
      return siguienteTrasCola({ ...ctx, colaId: cola.id, cola: cola.nombre, intentos: 0 }, l);
    }
    case "ELEGIR_CATEGORIA": {
      if (it.tipo !== "NUMERO" || it.n < 1 || it.n > l.categorias.length + 1) return invalido(estado, ctx, l, "Responde con el número del tipo de atención.");
      return siguienteTrasCola({ ...ctx, categoria: it.n === 1 ? "GENERAL" : l.categorias[it.n - 2].codigo, intentos: 0 }, l);
    }
    case "PEDIR_NOMBRE": {
      if (it.tipo === "OMITIR" || it.tipo === "NO") return siguienteTrasCola({ ...ctx, nombreOmitido: true, intentos: 0 }, l);
      const nombre = entrada.texto.replace(/[\u0000-\u001f<>*_~`]/g, "").trim().slice(0, 60);
      if (nombre.length < 2) return invalido(estado, ctx, l, "Escribe tu nombre o *omitir*.");
      return siguienteTrasCola({ ...ctx, nombre, intentos: 0 }, l);
    }
    case "PEDIR_CONSENTIMIENTO": {
      if (it.tipo === "SI") {
        const r = siguienteTrasCola({ ...ctx, consentimiento: true, intentos: 0 }, l);
        return { ...r, efectos: [{ tipo: "REGISTRAR_CONSENTIMIENTO" }, ...r.efectos] };
      }
      if (it.tipo === "NO") return menu(ctx, l, ["Sin tu permiso no podemos avisarte por aquí; puedes tomar turno en el mostrador o desde el QR del local."]);
      return invalido(estado, ctx, l, MENSAJES.consent);
    }
    case "CONFIRMAR_TURNO": {
      if (it.tipo === "SI" && ctx.colaId) {
        return { estado: "CONFIRMAR_TURNO", ctx, respuestas: [], efectos: [{ tipo: "EMITIR_TURNO", colaId: ctx.colaId, nombre: ctx.nombre, categoria: ctx.categoria }], intencion: "SI" };
      }
      if (it.tipo === "NO") return menu(ctx, l, ["Listo, no tomé el turno."]);
      return invalido(estado, ctx, l, `¿Confirmas el turno en *${ctx.cola}*? (*sí* / *no*)`);
    }
    case "ELEGIR_TURNO_ACTIVO": {
      const t = it.tipo === "NUMERO" ? l.turnosActivos[it.n - 1] : undefined;
      if (!t) return invalido(estado, ctx, l, "Responde con el número del turno.");
      return ctx.proposito === "CANCELAR" ? confirmarCancelar(t) : { estado: "SEGUIMIENTO", ctx: { intentos: 0, turnoToken: t.token }, respuestas: [textoTurno(t)], efectos: [], intencion: "NUMERO" };
    }
    case "CONFIRMAR_CANCELAR": {
      if (it.tipo === "SI" && ctx.turnoToken) return { estado: "MENU", ctx: { intentos: 0 }, respuestas: [], efectos: [{ tipo: "CANCELAR_TURNO", token: ctx.turnoToken }], intencion: "SI" };
      if (it.tipo === "NO") return menu(ctx, l, ["Tu turno sigue activo."]);
      return invalido(estado, ctx, l, "¿Cancelo tu turno? (*sí* / *no*)");
    }
    case "ELEGIR_FECHA": {
      const f = it.tipo === "NUMERO" ? l.fechasDisponibles[it.n - 1] : undefined;
      if (!f || !ctx.colaId) return invalido(estado, ctx, l, "Responde con el número de la fecha.");
      return { estado: "ELEGIR_HORA", ctx: { ...ctx, fecha: f, intentos: 0 }, respuestas: [], efectos: [{ tipo: "CARGAR_SLOTS", colaId: ctx.colaId, fecha: f }], intencion: "NUMERO" };
    }
    case "ELEGIR_HORA": {
      if (!l.slots.length) return menu(ctx, l, ["Ese día ya no tiene horarios libres."]);
      const s = it.tipo === "NUMERO" ? l.slots[it.n - 1] : undefined;
      if (!s) return invalido(estado, ctx, l, `Horarios libres:\n${l.slots.map((x, i) => `${n(i + 1)} ${x.hora}`).join("\n")}`);
      return { estado: "CONFIRMAR_CITA", ctx: { ...ctx, slotId: s.id, hora: s.hora, intentos: 0 }, respuestas: [`¿Reservo tu cita en *${ctx.cola}* el ${ctx.fecha} a las ${s.hora}? (*sí* / *no*)`], efectos: [], intencion: "NUMERO" };
    }
    case "CONFIRMAR_CITA": {
      if (it.tipo === "SI" && ctx.colaId && ctx.slotId) return { estado: "CONFIRMAR_CITA", ctx, respuestas: [], efectos: [{ tipo: "RESERVAR_CITA", colaId: ctx.colaId, slotId: ctx.slotId, nombre: ctx.nombre }], intencion: "SI" };
      if (it.tipo === "NO") return menu(ctx, l, ["No reservé la cita."]);
      return invalido(estado, ctx, l, "¿Confirmas la cita? (*sí* / *no*)");
    }
    default:
      return menu(ctx, l);
  }
}

/** Mensaje de lista de horarios tras cargar slots (efecto CARGAR_SLOTS). */
export function textoSlots(slots: { hora: string }[]) {
  return slots.length ? `Horarios libres:\n${slots.map((s, i) => `${n(i + 1)} ${s.hora}`).join("\n")}` : "Ese día ya no tiene horarios libres. Escribe *menu*.";
}

/** Tabla de transiciones como datos (fuente del diagrama Mermaid de la UI). */
export const TABLA: [EstadoBot, string, EstadoBot][] = [
  ["INICIO", "cualquiera", "MENU"],
  ["MENU", "1 / turno", "ELEGIR_COLA"],
  ["MENU", "2 / posición", "SEGUIMIENTO"],
  ["MENU", "3 / cancelar", "CONFIRMAR_CANCELAR"],
  ["MENU", "5 / cita", "ELEGIR_FECHA"],
  ["MENU", "6 / asesor", "HANDOFF"],
  ["ELEGIR_COLA", "n válido", "ELEGIR_CATEGORIA"],
  ["ELEGIR_COLA", "n válido (sin M1)", "PEDIR_NOMBRE"],
  ["ELEGIR_CATEGORIA", "n", "PEDIR_NOMBRE"],
  ["PEDIR_NOMBRE", "nombre / omitir", "PEDIR_CONSENTIMIENTO"],
  ["PEDIR_CONSENTIMIENTO", "sí", "CONFIRMAR_TURNO"],
  ["PEDIR_CONSENTIMIENTO", "no", "MENU"],
  ["CONFIRMAR_TURNO", "sí → EMITIR", "SEGUIMIENTO"],
  ["CONFIRMAR_TURNO", "no", "MENU"],
  ["ELEGIR_TURNO_ACTIVO", "n", "SEGUIMIENTO"],
  ["CONFIRMAR_CANCELAR", "sí → CANCELAR", "MENU"],
  ["ELEGIR_FECHA", "n", "ELEGIR_HORA"],
  ["ELEGIR_HORA", "n", "CONFIRMAR_CITA"],
  ["CONFIRMAR_CITA", "sí → RESERVAR", "SEGUIMIENTO"],
  ["HANDOFF", "menu", "MENU"],
  ["MENU", "salir", "CERRADA"],
  ["MENU", "15 min sin mensajes", "CERRADA"],
];

export function diagramaMermaid() {
  return ["stateDiagram-v2", ...TABLA.map(([a, e, b]) => `  ${a} --> ${b}: ${e.replace(/:/g, "")}`)].join("\n");
}
