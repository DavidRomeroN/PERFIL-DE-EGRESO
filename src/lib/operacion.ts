import { prisma } from "@/lib/db";
import { ErrorNegocio, fechaADate, fechaLocalISO } from "@/lib/turnos";
import { publicar } from "@/lib/realtime";
import { generarToken } from "@/lib/crypto";

const ORIGEN = Date.parse("2026-01-01T00:00:00Z");

export function claveOrden(peso: number, emitido: Date, alfa: number, aging: boolean) {
  const minutos = (emitido.getTime() - ORIGEN) / 60000;
  return peso - (aging ? alfa * minutos : 0);
}

export async function aplicarPrioridad(turnoId: number, codigoCategoria?: string | null) {
  const turno = await prisma.turno.findUnique({
    where: { id: turnoId },
    include: { local: { include: { plan: true } } },
  });
  if (!turno) return;
  if (turno.local.plan.codigo === "GRATIS") return;
  const config = await prisma.configPrioridad.findUnique({ where: { localId: turno.localId } });
  const alfa = Number(config?.alfaPuntosPorMin ?? 0);
  const aging = config?.agingActivo ?? false;
  const cat = codigoCategoria
    ? await prisma.categoriaPrioridad.findFirst({ where: { localId: turno.localId, codigo: codigoCategoria, activa: true } })
    : await prisma.categoriaPrioridad.findFirst({ where: { localId: turno.localId, codigo: "GENERAL" } });
  const peso = cat?.absoluta ? 1_000_000 : (cat?.pesoBase ?? 0);
  await prisma.turno.update({
    where: { id: turnoId },
    data: { categoriaId: cat?.id ?? null, claveOrden: claveOrden(peso, turno.emitidoAt, alfa, aging) },
  });
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
  publicar({ tipo: "cola:actualizada", localId });
  return nuevo;
}

export async function crearCita(input: { localId: number; colaId: number; inicioISO: string; nombre: string; telefono?: string | null }) {
  const cola = await prisma.cola.findUnique({ where: { id: input.colaId } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  const inicio = new Date(input.inicioISO);
  if (Number.isNaN(inicio.getTime()) || inicio.getTime() < Date.now()) throw new ErrorNegocio("VALIDACION", "La hora de la cita ya pasó", 422);
  const fin = new Date(inicio.getTime() + 15 * 60 * 1000);
  const ocupadas = await prisma.cita.count({ where: { colaId: input.colaId, estado: { in: ["RESERVADA", "CONFIRMADA"] }, inicio } });
  if (ocupadas >= 3) throw new ErrorNegocio("M3_SLOT_LLENO", "Ese horario ya no tiene cupo", 409);
  return prisma.cita.create({
    data: { localId: cola.localId, colaId: input.colaId, inicio, fin, nombre: input.nombre, telefono: input.telefono ?? null, token: generarToken(10) },
  });
}

export async function checkInCita(token: string) {
  const cita = await prisma.cita.findUnique({ where: { token }, include: { local: true } });
  if (!cita || cita.estado === "CANCELADA") throw new ErrorNegocio("NO_ENCONTRADO", "La cita no existe", 404);
  if (cita.turnoId) throw new ErrorNegocio("VALIDACION", "Esta cita ya hizo check-in", 409);
  const ahora = Date.now();
  if (ahora < cita.inicio.getTime() - 20 * 60 * 1000 || ahora > cita.inicio.getTime() + 15 * 60 * 1000) {
    throw new ErrorNegocio("M3_FUERA_DE_VENTANA", "El check-in es desde 20 min antes hasta 15 min después", 409);
  }
  const { emitirTurno } = await import("@/lib/turnos");
  const turno = await emitirTurno({ colaId: cita.colaId, canal: "QR", nombre: cita.nombre, telefono: cita.telefono, consentimiento: true });
  await aplicarPrioridad(turno.id, "CITA");
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

/** Erlang C: probabilidad de esperar y servidores mínimos para un objetivo. */
export function erlangC(llegadasPorHora: number, servicioMin: number, servidores: number) {
  const mu = 60 / Math.max(servicioMin, 1);
  const lambda = llegadasPorHora;
  const a = lambda / mu;
  if (servidores <= a) return { estable: false, probabilidadEspera: 1, esperaMin: Infinity, ocupacion: a / servidores };
  let sum = 1;
  let term = 1;
  for (let k = 1; k < servidores; k++) {
    term *= a / k;
    sum += term;
  }
  const ultimo = (term * a) / servidores;
  const pw = (ultimo * (servidores / (servidores - a))) / (sum + ultimo * (servidores / (servidores - a)));
  const esperaHoras = pw / (servidores * mu - lambda);
  return { estable: true, probabilidadEspera: pw, esperaMin: esperaHoras * 60, ocupacion: a / servidores };
}

export function fechaHoy(zona: string) {
  return fechaADate(fechaLocalISO(zona));
}
