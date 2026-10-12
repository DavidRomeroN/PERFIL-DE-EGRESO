import { prisma } from "@/lib/db";
import { ErrorNegocio, fechaADate, fechaLocalISO } from "@/lib/turnos";
import { publicar } from "@/lib/realtime";
import { generarToken } from "@/lib/crypto";

const ORIGEN = Date.parse("2026-01-01T00:00:00Z");

export function claveOrden(peso: number, emitido: Date, alfa: number, aging: boolean) {
  const minutos = (emitido.getTime() - ORIGEN) / 60000;
  return peso - (aging ? alfa * minutos : 0);
}

export type OrigenCategoria = "CLIENTE" | "PERSONAL" | "CITA";

export async function resolverCategoria(localId: number, codigo: string | null | undefined, origen: OrigenCategoria) {
  const cod = codigo?.trim() || "GENERAL";
  const cat = await prisma.categoriaPrioridad.findFirst({ where: { localId, codigo: cod, activa: true } });
  if (!cat && cod === "GENERAL") return null;
  if (!cat) throw new ErrorNegocio("M1_CATEGORIA_INVALIDA", "La categoría no existe", 404);
  if (origen === "CLIENTE" && !cat.visibleCliente) {
    throw new ErrorNegocio("M1_CATEGORIA_NO_DISPONIBLE", "Esa categoría solo la asigna el personal", 409);
  }
  if (cod === "CITA" && origen !== "CITA") {
    throw new ErrorNegocio("M1_CATEGORIA_NO_DISPONIBLE", "Categoría reservada para citas", 409);
  }
  return cat;
}

export async function aplicarPrioridad(turnoId: number, codigoCategoria: string | null | undefined, origen: OrigenCategoria) {
  const turno = await prisma.turno.findUnique({
    where: { id: turnoId },
    include: { local: { include: { plan: true } } },
  });
  if (!turno) return;
  const { moduloActivo } = await import("@/lib/modulos");
  if (!moduloActivo(turno.local.plan.codigo, "M1")) return;
  const config = await prisma.configPrioridad.findUnique({ where: { localId: turno.localId } });
  const alfa = Number(config?.alfaPuntosPorMin ?? 0);
  const aging = config?.agingActivo ?? false;
  const cat = await resolverCategoria(turno.localId, codigoCategoria, origen);
  const peso = cat?.absoluta ? 1_000_000 : (cat?.pesoBase ?? 0);
  await prisma.turno.update({
    where: { id: turnoId },
    data: { categoriaId: cat?.id ?? null, claveOrden: claveOrden(peso, turno.emitidoAt, alfa, aging), prioridadVerificada: origen === "PERSONAL" ? true : null },
  });
}

export async function recalcularClaves(localId: number) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const turnos = await prisma.turno.findMany({
    where: { localId, estado: { in: ["EMITIDO", "AVISADO"] }, fecha: { gte: hoy } },
    include: { categoria: true },
  });
  const config = await prisma.configPrioridad.findUnique({ where: { localId } });
  const alfa = Number(config?.alfaPuntosPorMin ?? 0);
  const aging = config?.agingActivo ?? false;
  for (const t of turnos) {
    const peso = t.categoria?.absoluta ? 1_000_000 : (t.categoria?.pesoBase ?? 0);
    await prisma.turno.update({ where: { id: t.id }, data: { claveOrden: claveOrden(peso, t.emitidoAt, alfa, aging) } });
  }
  publicar({ tipo: "cola:actualizada", localId });
}

/** Elige el siguiente turno: mayor clave, con tope de adelantos (RN-M1-03). */
export async function elegirSiguiente<T extends { id: number; claveOrden: number; emitidoAt: Date; categoria: { pesoBase: number; absoluta: boolean } | null }>(
  candidatos: T[],
  colaId: number,
  fecha: Date,
) {
  if (candidatos.length === 0) return null;
  const ordenados = [...candidatos].sort((a, b) => b.claveOrden - a.claveOrden || a.emitidoAt.getTime() - b.emitidoAt.getTime() || a.id - b.id);
  const estado = await prisma.estadoPrioridadCola.findUnique({ where: { colaId_fecha: { colaId, fecha } } });
  const config = await prisma.cola.findUnique({ where: { id: colaId }, include: { local: { include: { configPrioridad: true } } } });
  const tope = config?.local.configPrioridad?.topeAdelantos ?? 0;
  const seguidos = estado?.preferentesConsecutivos ?? 0;
  const mejor = ordenados[0];
  const esPreferente = (t: T) => (t.categoria?.pesoBase ?? 0) > 0 && !t.categoria?.absoluta;
  const hayGeneral = ordenados.some((t) => (t.categoria?.pesoBase ?? 0) === 0 && !t.categoria?.absoluta);
  if (tope > 0 && seguidos >= tope && esPreferente(mejor) && hayGeneral) {
    return ordenados.find((t) => (t.categoria?.pesoBase ?? 0) === 0 && !t.categoria?.absoluta) ?? mejor;
  }
  return mejor;
}

export async function registrarLlamadoPrioridad(turno: { id: number; colaId: number; fecha: Date; categoria: { pesoBase: number; absoluta: boolean } | null }) {
  const preferente = (turno.categoria?.pesoBase ?? 0) > 0 && !turno.categoria?.absoluta;
  const actual = await prisma.estadoPrioridadCola.findUnique({ where: { colaId_fecha: { colaId: turno.colaId, fecha: turno.fecha } } });
  const siguiente = preferente ? (actual?.preferentesConsecutivos ?? 0) + 1 : 0;
  await prisma.estadoPrioridadCola.upsert({
    where: { colaId_fecha: { colaId: turno.colaId, fecha: turno.fecha } },
    create: { colaId: turno.colaId, fecha: turno.fecha, preferentesConsecutivos: siguiente },
    update: { preferentesConsecutivos: siguiente },
  });
}

export async function localAbierto(localId: number, zona: string) {
  const horarios = await prisma.horarioLocal.findMany({ where: { localId, activo: true } });
  if (horarios.length === 0) return { abierto: true, mensaje: null as string | null };
  const ahora = new Date();
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ahora);
  const wd = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = mapa[wd] ?? 1;
  const hh = partes.find((p) => p.type === "hour")?.value ?? "00";
  const mm = partes.find((p) => p.type === "minute")?.value ?? "00";
  const mins = Number(hh) * 60 + Number(mm);
  const hoy = horarios.find((h) => h.diaSemana === dia);
  if (!hoy) return { abierto: false, mensaje: "Hoy no atendemos." };
  const [ah, am] = hoy.apertura.split(":").map(Number);
  const [ch, cm] = hoy.cierre.split(":").map(Number);
  const abierto = mins >= ah * 60 + am && mins < ch * 60 + cm;
  return { abierto, mensaje: abierto ? null : `Abrimos de ${hoy.apertura} a ${hoy.cierre}.` };
}

export async function expirarLlamados() {
  const locales = await prisma.local.findMany({ where: { activo: true, tiempoAusenciaSeg: { not: null } }, select: { id: true, tiempoAusenciaSeg: true } });
  let n = 0;
  for (const local of locales) {
    const limite = new Date(Date.now() - (local.tiempoAusenciaSeg ?? 180) * 1000);
    const vencidos = await prisma.turno.findMany({ where: { localId: local.id, estado: "LLAMADO", llamadoAt: { lte: limite } } });
    for (const t of vencidos) {
      await prisma.turno.update({ where: { id: t.id }, data: { estado: "NO_SE_PRESENTO", finalizadoAt: new Date() } });
      publicar({ tipo: "turno:estado", localId: local.id, turno: { id: t.id, token: t.token, estado: "NO_SE_PRESENTO" } });
      publicar({ tipo: "cola:actualizada", localId: local.id });
      n++;
    }
  }
  return n;
}

export async function transferirTurno(turnoId: number, localId: number, colaDestinoId: number) {
  const origen = await prisma.turno.findFirst({ where: { id: turnoId, localId }, include: { cola: true } });
  if (!origen || !["EMITIDO", "AVISADO"].includes(origen.estado)) {
    throw new ErrorNegocio("TRANSICION_INVALIDA", "Solo se transfiere un turno que aún está en espera", 409);
  }
  const destino = await prisma.cola.findFirst({ where: { id: colaDestinoId, localId, activa: true } });
  if (!destino) throw new ErrorNegocio("COLA_INACTIVA", "La cola destino no existe", 404);
  if (destino.id === origen.colaId) throw new ErrorNegocio("VALIDACION", "Elige otra cola", 422);

  const { emitirTurno } = await import("@/lib/turnos");
  await prisma.turno.update({ where: { id: origen.id }, data: { estado: "TRANSFERIDO", finalizadoAt: new Date() } });
  let nuevo;
  try {
    nuevo = await emitirTurno({ colaId: destino.id, canal: "QR", nombre: null, telefono: null });
    await prisma.turno.update({
      where: { id: nuevo.id },
      data: { emitidoAt: origen.emitidoAt, claveOrden: origen.claveOrden, categoriaId: origen.categoriaId, clienteId: origen.clienteId },
    });
  } catch (e) {
    await prisma.turno.update({ where: { id: origen.id }, data: { estado: origen.estado, finalizadoAt: null } });
    throw e;
  }
  await prisma.auditoria.create({
    data: { localId, accion: "TRANSFERIR_TURNO", entidad: "turno", entidadId: String(origen.id), datosJson: { sucesorId: nuevo.id, colaDestinoId } },
  });
  publicar({ tipo: "cola:actualizada", localId });
  return nuevo;
}

export async function slotsCita(slug: string, colaId: number) {
  const local = await prisma.local.findUnique({ where: { slug }, include: { horarios: true, colas: { where: { id: colaId, activa: true } } } });
  if (!local || local.colas.length === 0) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const horarios = local.horarios.filter((h) => h.activo);
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde.getTime() + 14 * 86400000);
  const ocupadas = await prisma.cita.groupBy({
    by: ["inicio"],
    where: { colaId, estado: { in: ["RESERVADA", "CONFIRMADA"] }, inicio: { gte: new Date(), lt: hasta } },
    _count: true,
  });
  const cupo = new Map(ocupadas.map((o) => [o.inicio.toISOString(), o._count]));
  const slots: { inicio: string; libres: number }[] = [];
  for (let d = 0; d < 14; d++) {
    const dia = new Date(desde.getTime() + d * 86400000);
    const wd = dia.getDay();
    const h = horarios.find((x) => x.diaSemana === wd);
    if (!h) continue;
    const [ah, am] = h.apertura.split(":").map(Number);
    const [ch, cm] = h.cierre.split(":").map(Number);
    for (let m = ah * 60 + am; m + 15 <= ch * 60 + cm; m += 15) {
      const inicio = new Date(dia);
      inicio.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (inicio.getTime() < Date.now() + 30 * 60 * 1000) continue;
      const usados = cupo.get(inicio.toISOString()) ?? 0;
      if (usados >= 3) continue;
      slots.push({ inicio: inicio.toISOString(), libres: 3 - usados });
    }
  }
  return slots;
}

export function pinCita(token: string) {
  return token.slice(-4).toUpperCase();
}

export async function crearCita(input: { localId: number; colaId: number; inicioISO: string; nombre: string; telefono?: string | null }) {
  const cola = await prisma.cola.findUnique({ where: { id: input.colaId } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const inicio = new Date(input.inicioISO);
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() < Date.now()) throw new ErrorNegocio("VALIDACION", "La hora de la cita ya pasó", 422);
  const fin = new Date(inicio.getTime() + 15 * 60 * 1000);
  return prisma.$transaction(async (tx) => {
    const ocupadas = await tx.cita.count({ where: { colaId: input.colaId, estado: { in: ["RESERVADA", "CONFIRMADA"] }, inicio } });
    if (ocupadas >= 3) throw new ErrorNegocio("M3_SLOT_LLENO", "Ese horario ya no tiene cupo", 409);
    return tx.cita.create({
      data: { localId: cola.localId, colaId: input.colaId, inicio, fin, nombre: input.nombre, telefono: input.telefono ?? null, token: generarToken(10) },
    });
  });
}

export async function checkInCita(token: string, pin?: string | null) {
  const cita = await prisma.cita.findUnique({ where: { token }, include: { local: true } });
  if (!cita || cita.estado === "CANCELADA") throw new ErrorNegocio("NO_ENCONTRADO", "La cita no existe", 404);
  if (pin != null && pin.toUpperCase() !== pinCita(token)) throw new ErrorNegocio("VALIDACION", "El PIN no coincide", 401);
  if (cita.turnoId) throw new ErrorNegocio("VALIDACION", "Esta cita ya hizo check-in", 409);
  const ahora = Date.now();
  if (ahora < cita.inicio.getTime() - 20 * 60 * 1000 || ahora > cita.inicio.getTime() + 15 * 60 * 1000) {
    throw new ErrorNegocio("M3_FUERA_DE_VENTANA", "El check-in es desde 20 min antes hasta 15 min después", 409);
  }
  const { emitirTurno } = await import("@/lib/turnos");
  const turno = await emitirTurno({ colaId: cita.colaId, canal: "QR", nombre: cita.nombre, telefono: cita.telefono, consentimiento: true });
  await aplicarPrioridad(turno.id, "CITA", "CITA");
  await prisma.cita.update({ where: { id: cita.id }, data: { estado: "CHECKIN", turnoId: turno.id } });
  return turno;
}

export async function valorarTurno(token: string, estrellas: number, comentario?: string | null) {
  const turno = await prisma.turno.findUnique({ where: { token } });
  if (!turno || turno.estado !== "ATENDIDO") throw new ErrorNegocio("VALIDACION", "Solo se valora un turno ya atendido", 409);
  const previa = await prisma.valoracion.findUnique({ where: { turnoId: turno.id } });
  if (previa) throw new ErrorNegocio("VALIDACION", "Este turno ya fue valorado", 409);
  return prisma.valoracion.create({ data: { turnoId: turno.id, estrellas, comentario: comentario?.slice(0, 280) ?? null } });
}

export function fechaHoy(zona: string) {
  return fechaADate(fechaLocalISO(zona));
}
