import { createHash } from "crypto";
import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { publicar } from "@backend/realtime";
import { descifrar, generarToken } from "@backend/crypto";
import { exigirModulo, moduloActivo } from "@backend/modulos";
import { enviarAviso } from "@backend/notificaciones";
import { contar } from "@backend/metricas";
import { log } from "@backend/log";
import { fechaLocalISO, sumarDiasISO, fechaADate, partesLocales } from "@backend/fechas";
import type { CanalCita, ConfigCitas, EstadoTurno } from "@backend/generated/prisma/client";
import {
  capacidadSlot,
  debeBloquear,
  dentroDeAnticipacion,
  emisionDeCita,
  franjasDelDia,
  generarIcs,
  pinPresencia,
  segundosRestantesPin,
  transicionCitaValida,
  validarPin,
  ventanaCheckin,
  ventanaPin,
  type EstadoCita,
} from "@backend/citas/reglas";

/** M3 · Casos de uso de citas (docs/modulos/M3-citas-reservas.md). */

const ACTIVAS: EstadoCita[] = ["RESERVADA", "CONFIRMADA"];

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Secreto del PIN de presencia por local, derivado de la clave de cifrado (no se guarda en la BD). */
function secretoPin(localId: number) {
  return createHash("sha256").update(`pin-presencia:${localId}:${process.env.DATA_ENCRYPTION_KEY ?? "dev"}`).digest("hex");
}

export async function configCola(colaId: number): Promise<ConfigCitas> {
  return prisma.configCitas.upsert({ where: { colaId }, create: { colaId }, update: {} });
}

async function evento(citaId: number, tipo: string, datos?: unknown, actor?: string) {
  await prisma.citaEvento.create({ data: { citaId, tipo, datos: (datos ?? undefined) as never, actor: actor ?? null } });
}

async function localPorSlug(slug: string) {
  const local = await prisma.local.findUnique({ where: { slug } });
  if (!local || !local.activo) throw new ErrorNegocio("LOCAL_NO_ENCONTRADO", "El local no existe", 404);
  await exigirModulo(local.id, "M3");
  return local;
}

async function colaConCitas(localId: number, colaId: number) {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId, activa: true }, include: { configCitas: true, ventanillas: { where: { activa: true } } } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  if (!cola.configCitas?.activo) throw new ErrorNegocio("M3_COLA_SIN_CITAS", "Este servicio no atiende con cita", 409);
  return { cola, cfg: cola.configCitas };
}

// ---------------------------------------------------------------------------
// §6.1 Generación perezosa e idempotente de slots
// ---------------------------------------------------------------------------
export async function generarSlots(colaId: number, fechaISO: string, ahora = new Date()) {
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, include: { local: { include: { horarios: { where: { activo: true } } } }, configCitas: true, ventanillas: { where: { activa: true } } } });
  if (!cola || !cola.configCitas) return 0;
  const zona = cola.local.zonaHoraria;
  const diaSemana = partesLocales(zona, new Date(`${fechaISO}T17:00:00Z`)).diaSemana;
  const tramos = cola.local.horarios.filter((h) => h.diaSemana === diaSemana).map((h) => ({ apertura: h.apertura, cierre: h.cierre }));
  if (!tramos.length) return 0;
  const inicioDia = new Date(`${fechaISO}T00:00:00Z`);
  const bloqueos = await prisma.bloqueoAgenda.findMany({
    where: { localId: cola.localId, OR: [{ colaId: null }, { colaId }], inicio: { lt: new Date(inicioDia.getTime() + 2 * 86400000) }, fin: { gt: new Date(inicioDia.getTime() - 86400000) } },
  });
  const franjas = franjasDelDia(fechaISO, tramos, cola.configCitas.duracionSlotMin, zona, bloqueos, ahora);
  const capacidad = capacidadSlot(Math.max(1, cola.ventanillas.length), cola.configCitas.cuotaCitasPct, cola.configCitas.capacidadFija);
  if (!franjas.length) return 0;
  const r = await prisma.slot.createMany({ data: franjas.map((f) => ({ colaId, inicio: f.inicio, fin: f.fin, capacidad })), skipDuplicates: true });
  return r.count;
}

/** GET /public/locales/:slug/slots — horarios de un día con cupos restantes. */
export async function slotsDelDia(slug: string, colaId: number, fechaISO: string, ahora = new Date()) {
  const local = await localPorSlug(slug);
  const { cfg } = await colaConCitas(local.id, colaId);
  await generarSlots(colaId, fechaISO, ahora);
  const desde = new Date(`${fechaISO}T00:00:00Z`);
  const slots = await prisma.slot.findMany({
    where: { colaId, inicio: { gte: new Date(desde.getTime() - 86400000), lt: new Date(desde.getTime() + 2 * 86400000) } },
    orderBy: { inicio: "asc" },
  });
  return slots
    .filter((s) => fechaLocalISO(local.zonaHoraria, s.inicio) === fechaISO)
    .map((s) => ({
      id: s.id,
      inicio: s.inicio.toISOString(),
      fin: s.fin.toISOString(),
      hora: new Intl.DateTimeFormat("es-PE", { timeZone: local.zonaHoraria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(s.inicio),
      restantes: Math.max(0, s.capacidad - s.reservados),
      disponible: s.reservados < s.capacidad && dentroDeAnticipacion(s.inicio, ahora, cfg.anticipacionMinMin, cfg.anticipacionMaxDias),
    }));
}

/** GET /public/locales/:slug/disponibilidad — resumen por día (14 días). */
export async function disponibilidad(slug: string, colaId: number, dias = 14, ahora = new Date()) {
  const local = await localPorSlug(slug);
  const { cfg } = await colaConCitas(local.id, colaId);
  const hoy = fechaLocalISO(local.zonaHoraria, ahora);
  const n = Math.min(dias, cfg.anticipacionMaxDias + 1);
  const salida: { fecha: string; abierto: boolean; libres: number }[] = [];
  for (let d = 0; d < n; d++) {
    const f = sumarDiasISO(hoy, d);
    const slots = await slotsDelDia(slug, colaId, f, ahora);
    salida.push({ fecha: f, abierto: slots.length > 0, libres: slots.filter((s) => s.disponible).reduce((a, s) => a + s.restantes, 0) });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// §6.2 Reserva sin sobrecupo (una sola sentencia)
// ---------------------------------------------------------------------------
export interface ReservaInput {
  slug?: string;
  localId?: number;
  colaId: number;
  slotId: number;
  nombre: string;
  telefono?: string | null;
  consentimiento?: boolean;
  canal?: CanalCita;
  clienteId?: number | null;
}

export async function reservar(input: ReservaInput, ahora = new Date()) {
  const local = input.slug ? await localPorSlug(input.slug) : await prisma.local.findUniqueOrThrow({ where: { id: input.localId! } });
  if (!input.slug) await exigirModulo(local.id, "M3");
  const { cola, cfg } = await colaConCitas(local.id, input.colaId);

  const { resolverCliente } = await import("@backend/turnos");
  const clienteId = input.clienteId ?? (await resolverCliente({ telefono: input.telefono, nombre: input.nombre, consentimiento: input.consentimiento }));
  if (!clienteId) throw new ErrorNegocio("VALIDACION", "Indica tu nombre", 422);

  // Validaciones previas: bloqueo por reincidencia y límite de citas futuras (RN-M3-01/06)
  const bloqueo = await prisma.bloqueoCliente.findFirst({ where: { localId: local.id, clienteId, hasta: { gt: ahora }, liberadoPor: null }, orderBy: { hasta: "desc" } });
  if (bloqueo) {
    throw new ErrorNegocio("M3_CLIENTE_BLOQUEADO", `Reservas bloqueadas hasta ${bloqueo.hasta.toLocaleDateString("es-PE", { timeZone: local.zonaHoraria })} por inasistencias`, 403, { hasta: bloqueo.hasta.toISOString() });
  }
  const futuras = await prisma.cita.count({ where: { clienteId, estado: { in: ACTIVAS }, inicio: { gt: ahora } } });
  if (futuras >= 3) throw new ErrorNegocio("M3_LIMITE_CITAS", "Ya tienes 3 citas futuras activas", 409);

  const minInicio = new Date(ahora.getTime() + cfg.anticipacionMinMin * 60000);
  const maxInicio = new Date(ahora.getTime() + cfg.anticipacionMaxDias * 86400000);
  const canal = input.canal ?? "WEB";

  for (let intento = 0; intento < 3; intento++) {
    const token = generarToken(10);
    const codigo = generarToken(6);
    try {
      const rows = await prisma.$queryRaw<{ id: number }[]>`
        WITH cupo AS (
          UPDATE slot s SET reservados = s.reservados + 1
           WHERE s.id = ${input.slotId}::int AND s.cola_id = ${cola.id}::int
             AND s.reservados < s.capacidad
             AND s.inicio >= ${minInicio} AND s.inicio <= ${maxInicio}
          RETURNING s.id, s.cola_id, s.inicio, s.fin
        )
        INSERT INTO cita (local_id, cola_id, slot_id, cliente_id, fecha, inicio, fin, token, codigo_checkin, canal, estado)
        SELECT ${local.id}::int, c.cola_id, c.id, ${clienteId}::int,
               ((c.inicio AT TIME ZONE 'UTC') AT TIME ZONE ${local.zonaHoraria})::date,
               c.inicio, c.fin, ${token}, ${codigo}, ${canal}::"CanalCita", 'RESERVADA'
          FROM cupo c
        RETURNING id`;
      if (!rows.length) {
        const slot = await prisma.slot.findFirst({ where: { id: input.slotId, colaId: cola.id } });
        contar("m3_reservas_total", { resultado: "rechazada" });
        if (!slot) throw new ErrorNegocio("M3_SLOT_LLENO", "Ese horario no existe", 404);
        if (slot.inicio <= ahora) throw new ErrorNegocio("M3_SLOT_PASADO", "Ese horario ya pasó", 409);
        if (slot.inicio < minInicio || slot.inicio > maxInicio) {
          throw new ErrorNegocio("M3_FUERA_DE_ANTICIPACION", `Reserva con al menos ${cfg.anticipacionMinMin} min y hasta ${cfg.anticipacionMaxDias} días de anticipación`, 422);
        }
        contar("m3_slot_lleno_total");
        throw new ErrorNegocio("M3_SLOT_LLENO", "Ese horario ya no tiene cupo", 409);
      }
      const id = rows[0].id;
      await evento(id, "RESERVADA", { canal });
      contar("m3_reservas_total", { resultado: "ok" });
      const cita = await obtenerCitaPorId(id);
      void notificarCita(id, "confirmada").catch(() => {});
      publicar({ tipo: "cita:estado", localId: local.id, cita: { id, token, estado: "RESERVADA" } });
      return cita;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ux_cita_activa")) throw new ErrorNegocio("M3_CITA_DUPLICADA", "Ya tienes una cita activa ese día en este servicio", 409);
      if (msg.includes("cita_codigo_checkin_key") || msg.includes("cita_token_key")) continue;
      throw e;
    }
  }
  throw new ErrorNegocio("ERROR_INTERNO", "No se pudo registrar la cita", 500);
}

async function obtenerCitaPorId(id: number) {
  const c = await prisma.cita.findUniqueOrThrow({ where: { id }, include: { cola: true, local: true } });
  return vistaCita(c);
}

function vistaCita(c: { id: number; token: string; codigoCheckin: string; estado: string; inicio: Date; fin: Date; tarde: boolean; turnoId: number | null; cola: { id: number; nombre: string }; local: { slug: string; nombreComercial: string; zonaHoraria: string; direccion: string | null } }) {
  const fmt = new Intl.DateTimeFormat("es-PE", { timeZone: c.local.zonaHoraria, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return {
    id: c.id,
    token: c.token,
    codigoCheckin: c.codigoCheckin,
    estado: c.estado,
    inicio: c.inicio.toISOString(),
    fin: c.fin.toISOString(),
    inicioLocal: fmt.format(c.inicio),
    tarde: c.tarde,
    cola: { id: c.cola.id, nombre: c.cola.nombre },
    local: { slug: c.local.slug, nombreComercial: c.local.nombreComercial, direccion: c.local.direccion },
    urlQr: `${appUrl()}/c/${c.token}`,
  };
}

/** GET /public/citas/:token — sin datos personales. */
export async function obtenerCita(token: string) {
  const c = await prisma.cita.findUnique({ where: { token }, include: { cola: true, local: true, turno: { select: { token: true, codigo: true, estado: true } }, slot: true } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  const cfg = await configCola(c.colaId);
  const v = ventanaCheckin(c.inicio, new Date(), cfg);
  return {
    ...vistaCita(c),
    turno: c.turno,
    checkin: { ventana: v.tipo, disponibleDesde: v.tipo === "TEMPRANO" ? v.disponibleDesde.toISOString() : null, antesMin: cfg.checkinAntesMin, despuesMin: cfg.checkinDespuesMin },
    puedeCancelar: ACTIVAS.includes(c.estado as EstadoCita) && c.inicio > new Date(),
  };
}

async function citaPorToken(token: string) {
  const c = await prisma.cita.findUnique({ where: { token }, include: { local: true } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  return c;
}

async function cambiarEstado(citaId: number, desde: EstadoCita[], hacia: EstadoCita, data: Record<string, unknown> = {}) {
  for (const d of desde) if (!transicionCitaValida(d, hacia)) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "Transición de cita inválida", 409);
  const r = await prisma.cita.updateMany({ where: { id: citaId, estado: { in: desde } }, data: { estado: hacia, ...data } });
  return r.count > 0;
}

export async function confirmar(token: string) {
  const c = await citaPorToken(token);
  if (!(await cambiarEstado(c.id, ["RESERVADA"], "CONFIRMADA", { confirmadaAt: new Date() }))) {
    if (c.estado === "CONFIRMADA") return obtenerCita(token);
    throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita ya no se puede confirmar", 409);
  }
  await evento(c.id, "CONFIRMADA");
  publicar({ tipo: "cita:estado", localId: c.localId, cita: { id: c.id, token, estado: "CONFIRMADA" } });
  return obtenerCita(token);
}

/** §6.3: cancelar devuelve el cupo en la misma transacción. */
export async function cancelar(citaId: number, motivo = "Cancelada por el cliente", actor = "cliente") {
  const ok = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ slot_id: number }[]>`
      UPDATE cita SET estado = 'CANCELADA', cancelada_at = now(), motivo_cancelacion = ${motivo}
       WHERE id = ${citaId}::int AND estado IN ('RESERVADA', 'CONFIRMADA') RETURNING slot_id`;
    if (!rows.length) return false;
    await tx.$executeRaw`UPDATE slot SET reservados = reservados - 1 WHERE id = ${rows[0].slot_id}::int AND reservados > 0`;
    return true;
  });
  if (!ok) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita ya no se puede cancelar", 409);
  const c = await prisma.cita.findUniqueOrThrow({ where: { id: citaId } });
  await evento(citaId, "CANCELADA", { motivo }, actor);
  publicar({ tipo: "cita:estado", localId: c.localId, cita: { id: c.id, token: c.token, estado: "CANCELADA" } });
  return c;
}

export async function cancelarPorToken(token: string) {
  const c = await citaPorToken(token);
  if (c.inicio <= new Date()) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita ya empezó; no se puede cancelar en línea", 409);
  await cancelar(c.id);
  return obtenerCita(token);
}

/** §6.3: reprogramar es atómico; si el nuevo slot está lleno la cita original queda intacta. */
export async function reprogramar(citaId: number, nuevoSlotId: number, actor = "cliente", ahora = new Date(), porAdmin = false) {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, include: { local: true } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  if (!ACTIVAS.includes(c.estado as EstadoCita)) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita ya no se puede cambiar", 409);
  if (nuevoSlotId === c.slotId) return c;
  const cfg = await configCola(c.colaId);
  // El admin puede mover a cualquier horario futuro; el cliente respeta la anticipación (RN-M3-02)
  const minInicio = porAdmin ? ahora : new Date(ahora.getTime() + cfg.anticipacionMinMin * 60000);
  const maxInicio = porAdmin ? new Date(ahora.getTime() + 366 * 86400000) : new Date(ahora.getTime() + cfg.anticipacionMaxDias * 86400000);
  await prisma.$transaction(async (tx) => {
    // Orden fijo de bloqueo ⇒ sin deadlocks entre reprogramaciones cruzadas
    await tx.$queryRaw`SELECT id FROM slot WHERE id IN (${c.slotId}::int, ${nuevoSlotId}::int) ORDER BY id FOR UPDATE`;
    const tomado = await tx.$queryRaw<{ inicio: Date; fin: Date }[]>`
      UPDATE slot SET reservados = reservados + 1
       WHERE id = ${nuevoSlotId}::int AND cola_id = ${c.colaId}::int AND reservados < capacidad
         AND inicio >= ${minInicio} AND inicio <= ${maxInicio}
      RETURNING inicio, fin`;
    if (!tomado.length) throw new ErrorNegocio("M3_SLOT_LLENO", "Ese horario ya no tiene cupo; tu cita se mantiene", 409);
    await tx.$executeRaw`UPDATE slot SET reservados = reservados - 1 WHERE id = ${c.slotId}::int AND reservados > 0`;
    const fecha = fechaADate(fechaLocalISO(c.local.zonaHoraria, tomado[0].inicio));
    await tx.cita.update({ where: { id: c.id }, data: { slotId: nuevoSlotId, inicio: tomado[0].inicio, fin: tomado[0].fin, fecha, estado: "RESERVADA", confirmadaAt: null } });
  }).catch((e) => {
    if (e instanceof Error && e.message.includes("ux_cita_activa")) throw new ErrorNegocio("M3_CITA_DUPLICADA", "Ya tienes otra cita ese día en este servicio", 409);
    throw e;
  });
  await prisma.citaRecordatorio.deleteMany({ where: { citaId: c.id } });
  await evento(c.id, "REPROGRAMADA", { de: c.slotId, a: nuevoSlotId }, actor);
  publicar({ tipo: "cita:estado", localId: c.localId, cita: { id: c.id, token: c.token, estado: "RESERVADA" } });
  return prisma.cita.findUniqueOrThrow({ where: { id: c.id } });
}

// ---------------------------------------------------------------------------
// §6.5 Check-in
// ---------------------------------------------------------------------------
export async function checkin(token: string, opciones: { pin?: string | null; presencial?: boolean; actor?: string } = {}, ahora = new Date()) {
  const c = await prisma.cita.findUnique({ where: { token }, include: { local: true, cliente: true } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  await exigirModulo(c.localId, "M3");
  if (c.estado === "CHECKIN" && c.turnoId) {
    const t = await prisma.turno.findUnique({ where: { id: c.turnoId } });
    if (t) return { turnoToken: t.token, codigo: t.codigo, tarde: c.tarde, repetido: true };
  }
  if (!ACTIVAS.includes(c.estado as EstadoCita)) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita no admite check-in", 409);
  const cfg = await configCola(c.colaId);
  const v = ventanaCheckin(c.inicio, ahora, cfg);
  if (v.tipo === "TEMPRANO") {
    const hora = new Intl.DateTimeFormat("es-PE", { timeZone: c.local.zonaHoraria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(v.disponibleDesde);
    throw new ErrorNegocio("M3_CHECKIN_MUY_TEMPRANO", `El check-in está disponible desde las ${hora}`, 409, { disponibleDesde: v.disponibleDesde.toISOString() });
  }
  if (v.tipo === "VENCIDA") throw new ErrorNegocio("M3_CITA_VENCIDA", "La cita venció; acércate al mostrador", 409);

  if (!opciones.presencial) {
    if (!opciones.pin) throw new ErrorNegocio("M3_PIN_INVALIDO", "Ingresa el PIN que aparece en la pantalla del local", 403);
    // 5 intentos fallidos de PIN ⇒ bloqueo de 5 min por cita
    const clave = `pin:${c.id}`;
    const ventana = new Date(Math.floor(ahora.getTime() / 300000) * 300000);
    const fallos = await prisma.rateLimit.findUnique({ where: { clave_ventana: { clave, ventana } } });
    if ((fallos?.contador ?? 0) >= 5) throw new ErrorNegocio("RATE_LIMIT", "Demasiados intentos; espera 5 minutos", 429);
    if (!validarPin(secretoPin(c.localId), c.localId, opciones.pin, ahora.getTime())) {
      await prisma.rateLimit.upsert({ where: { clave_ventana: { clave, ventana } }, create: { clave, ventana, contador: 1 }, update: { contador: { increment: 1 } } });
      throw new ErrorNegocio("M3_PIN_INVALIDO", "El PIN no coincide con el de la pantalla", 403);
    }
  }

  const tarde = v.tipo === "TARDE";
  const { emitirTurno } = await import("@backend/turnos");
  const turno = await emitirTurno({
    colaId: c.colaId,
    canal: "CITA",
    clienteId: c.clienteId,
    categoriaCodigo: tarde ? null : "CITA",
    origenCategoria: "CITA",
    emitidoAt: emisionDeCita(c.inicio, ahora, tarde),
    citaId: c.id,
    omitirHorario: true,
  });
  await prisma.cita.update({ where: { id: c.id }, data: { estado: "CHECKIN", turnoId: turno.id, checkinAt: ahora, tarde } });
  await evento(c.id, "CHECKIN", { tarde, presencial: !!opciones.presencial }, opciones.actor ?? "cliente");
  contar("m3_checkin_total", { tipo: tarde ? "tarde" : "a_tiempo" });
  publicar({ tipo: "cita:estado", localId: c.localId, cita: { id: c.id, token: c.token, estado: "CHECKIN" } });
  return { turnoToken: turno.token, codigo: turno.codigo, tarde, repetido: false };
}

/** Check-in por el código corto (kiosco M5): estar frente al kiosco ya prueba presencia. */
export async function checkinPorCodigo(localId: number, codigo: string, ahora = new Date()) {
  const c = await prisma.cita.findFirst({ where: { localId, codigoCheckin: codigo.trim().toUpperCase() } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "No encontramos una cita con ese código", 404);
  return checkin(c.token, { presencial: true, actor: "kiosco" }, ahora);
}

/** RN-M3-07: al cerrar el turno de la cita se actualiza la cita. */
export async function cerrarCitaPorTurno(citaId: number, estadoTurno: EstadoTurno) {
  const hacia: EstadoCita | null = estadoTurno === "ATENDIDO" ? "ATENDIDA" : estadoTurno === "NO_SE_PRESENTO" ? "NO_SHOW" : null;
  if (!hacia) return;
  const c = await prisma.cita.findUnique({ where: { id: citaId } });
  if (!c || c.estado !== "CHECKIN") return;
  await prisma.cita.update({ where: { id: c.id }, data: { estado: hacia } });
  await evento(c.id, hacia, { porTurno: true }, "sistema");
  if (hacia === "NO_SHOW") await aplicarBloqueo(c.localId, c.clienteId, c.colaId);
}

async function aplicarBloqueo(localId: number, clienteId: number, colaId: number) {
  const cfg = await configCola(colaId);
  const n = await prisma.cita.count({ where: { localId, clienteId, estado: "NO_SHOW", inicio: { gte: new Date(Date.now() - 90 * 86400000) } } });
  if (!debeBloquear(n, cfg.maxNoShow)) return false;
  const vigente = await prisma.bloqueoCliente.findFirst({ where: { localId, clienteId, hasta: { gt: new Date() }, liberadoPor: null } });
  if (vigente) return false;
  await prisma.bloqueoCliente.create({ data: { localId, clienteId, hasta: new Date(Date.now() + cfg.bloqueoDias * 86400000), motivo: `${n} inasistencias en 90 días` } });
  contar("m3_bloqueos_total");
  return true;
}

// ---------------------------------------------------------------------------
// PIN de presencia (TV, panel, kiosco)
// ---------------------------------------------------------------------------
export function pinActual(localId: number, ahora = Date.now()) {
  return { pin: pinPresencia(secretoPin(localId), localId, ventanaPin(ahora)), segundosRestantes: segundosRestantesPin(ahora) };
}

// ---------------------------------------------------------------------------
// .ics y notificaciones
// ---------------------------------------------------------------------------
export async function icsDeCita(token: string) {
  const c = await prisma.cita.findUnique({ where: { token }, include: { local: true, cola: true } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  return generarIcs({ id: c.id, inicio: c.inicio, fin: c.fin, local: c.local.nombreComercial, servicio: c.cola.nombre, direccion: c.local.direccion, url: `${appUrl()}/c/${c.token}`, zona: c.local.zonaHoraria });
}

async function notificarCita(citaId: number, tipo: "confirmada" | "24h" | "2h") {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, include: { local: true, cola: true, cliente: true } });
  if (!c?.cliente.telefonoCifrado) return null;
  const tel = descifrar(c.cliente.telefonoCifrado);
  if (!tel) return null;
  const cuando = new Intl.DateTimeFormat("es-PE", { timeZone: c.local.zonaHoraria, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(c.inicio);
  const url = `${appUrl()}/c/${c.token}`;
  const texto =
    tipo === "confirmada"
      ? `✅ Reservaste tu cita en *${c.local.nombreComercial}* (${c.cola.nombre}) para el ${cuando}. Código de check-in: *${c.codigoCheckin}*. Detalles: ${url}`
      : `⏰ Recordatorio: tu cita en *${c.local.nombreComercial}* (${c.cola.nombre}) es ${tipo === "24h" ? "mañana" : "en 2 horas"}, ${cuando}. Confirma o cancela aquí: ${url}`;
  return enviarAviso({ localId: c.localId, citaId: c.id, telefonoE164: tel, plantilla: tipo === "confirmada" ? "cita_confirmada" : "cita_recordatorio", texto });
}

// ---------------------------------------------------------------------------
// Jobs (§6.6, §6.7)
// ---------------------------------------------------------------------------

/** Recordatorios T−24 h y T−2 h; cada uno se envía una sola vez por cita (RN-M3-08). */
export async function jobRecordatorios(ahora = new Date()) {
  let enviados = 0;
  const citas = await prisma.cita.findMany({
    where: { estado: { in: ACTIVAS }, inicio: { gt: ahora, lt: new Date(ahora.getTime() + 25 * 3600_000) } },
    include: { cola: { include: { configCitas: true } } },
  });
  for (const c of citas) {
    if (!(await moduloActivo(c.localId, "M3"))) continue;
    for (const minutos of c.cola.configCitas?.recordatoriosMin ?? [1440, 120]) {
      const momento = c.inicio.getTime() - minutos * 60000;
      if (ahora.getTime() < momento || ahora.getTime() > momento + 60 * 60000) continue;
      const tipo = minutos >= 1440 ? "24h" : "2h";
      const r = await prisma.$executeRaw`INSERT INTO cita_recordatorio (cita_id, tipo) VALUES (${c.id}::int, ${tipo}) ON CONFLICT DO NOTHING`;
      if (Number(r) === 0) continue;
      await notificarCita(c.id, tipo);
      contar("m3_recordatorios_enviados_total");
      enviados++;
    }
  }
  return { enviados };
}

/** No-show: citas sin check-in pasada la ventana y la gracia; bloquea reincidentes (RN-M3-04/06). */
export async function jobNoShow(ahora = new Date()) {
  const vencidas = await prisma.$queryRaw<{ id: number; local_id: number; cliente_id: number; cola_id: number; token: string }[]>`
    UPDATE cita c SET estado = 'NO_SHOW'
      FROM config_citas cfg
     WHERE cfg.cola_id = c.cola_id AND c.estado IN ('RESERVADA', 'CONFIRMADA')
       AND c.inicio + make_interval(mins => cfg.checkin_despues_min + cfg.gracia_no_show_min) < ${ahora}
    RETURNING c.id, c.local_id, c.cliente_id, c.cola_id, c.token`;
  let bloqueados = 0;
  for (const v of vencidas) {
    await evento(v.id, "NO_SHOW", null, "sistema");
    publicar({ tipo: "cita:estado", localId: v.local_id, cita: { id: v.id, token: v.token, estado: "NO_SHOW" } });
    if (await aplicarBloqueo(v.local_id, v.cliente_id, v.cola_id)) bloqueados++;
  }
  // Liberar el cupo de las citas vencidas no hace falta: el slot ya pasó.
  contar("m3_no_show_total", undefined, vencidas.length);
  return { noShow: vencidas.length, bloqueados };
}

/** Prepara los slots de los próximos días de las colas con citas activas. */
export async function jobGenerarSlots(ahora = new Date()) {
  const cfgs = await prisma.configCitas.findMany({ where: { activo: true }, include: { cola: { include: { local: true } } } });
  let n = 0;
  for (const cfg of cfgs) {
    if (!(await moduloActivo(cfg.cola.localId, "M3"))) continue;
    const hoy = fechaLocalISO(cfg.cola.local.zonaHoraria, ahora);
    for (let d = 0; d <= cfg.anticipacionMaxDias; d++) n += await generarSlots(cfg.colaId, sumarDiasISO(hoy, d), ahora);
  }
  return { slotsCreados: n };
}

// ---------------------------------------------------------------------------
// Administración (agenda, configuración, bloqueos)
// ---------------------------------------------------------------------------
export async function agenda(localId: number, fechaISO: string, colaId?: number | null) {
  const citas = await prisma.cita.findMany({
    where: { localId, fecha: fechaADate(fechaISO), ...(colaId ? { colaId } : {}) },
    include: { cola: { select: { id: true, nombre: true } }, cliente: { select: { nombre: true, telefonoCifrado: true } }, turno: { select: { codigo: true, estado: true } } },
    orderBy: { inicio: "asc" },
  });
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId } });
  const desde = new Date(`${fechaISO}T00:00:00Z`);
  const slots = await prisma.slot.findMany({
    where: { cola: { localId }, ...(colaId ? { colaId } : {}), inicio: { gte: new Date(desde.getTime() - 86400000), lt: new Date(desde.getTime() + 2 * 86400000) } },
    orderBy: { inicio: "asc" },
    include: { cola: { select: { nombre: true } } },
  });
  const fmt = new Intl.DateTimeFormat("es-PE", { timeZone: local.zonaHoraria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const { enmascararTelefono } = await import("@backend/crypto");
  return {
    slots: slots.filter((s) => fechaLocalISO(local.zonaHoraria, s.inicio) === fechaISO).map((s) => ({ id: s.id, colaId: s.colaId, cola: s.cola.nombre, hora: fmt.format(s.inicio), capacidad: s.capacidad, reservados: s.reservados })),
    citas: citas.map((c) => {
      const tel = c.cliente.telefonoCifrado ? descifrar(c.cliente.telefonoCifrado) : null;
      return {
        id: c.id,
        token: c.token,
        hora: fmt.format(c.inicio),
        inicio: c.inicio.toISOString(),
        estado: c.estado,
        canal: c.canal,
        cola: c.cola,
        nombre: c.cliente.nombre,
        telefono: tel ? enmascararTelefono(tel) : null,
        codigoCheckin: c.codigoCheckin,
        turno: c.turno,
        tarde: c.tarde,
      };
    }),
  };
}

export async function proximas(localId: number, minutos = 60, ahora = new Date()) {
  const citas = await prisma.cita.findMany({
    where: { localId, estado: { in: ACTIVAS }, inicio: { gte: new Date(ahora.getTime() - 15 * 60000), lte: new Date(ahora.getTime() + minutos * 60000) } },
    include: { cola: { select: { nombre: true } }, cliente: { select: { nombre: true } } },
    orderBy: { inicio: "asc" },
    take: 20,
  });
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId } });
  const fmt = new Intl.DateTimeFormat("es-PE", { timeZone: local.zonaHoraria, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return citas.map((c) => ({ id: c.id, hora: fmt.format(c.inicio), cola: c.cola.nombre, nombre: c.cliente.nombre, estado: c.estado, codigoCheckin: c.codigoCheckin }));
}

export async function accionAdmin(localId: number, citaId: number, accion: "CANCELAR" | "MOVER" | "NO_SHOW" | "ASISTIO", slotId: number | undefined, actor: string) {
  const c = await prisma.cita.findFirst({ where: { id: citaId, localId } });
  if (!c) throw new ErrorNegocio("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  if (accion === "CANCELAR") return cancelar(c.id, "Cancelada por el local", actor);
  if (accion === "MOVER") {
    if (!slotId) throw new ErrorNegocio("VALIDACION", "Indica el nuevo horario", 422);
    return reprogramar(c.id, slotId, actor, new Date(), true);
  }
  if (accion === "NO_SHOW") {
    if (!(await cambiarEstado(c.id, ["RESERVADA", "CONFIRMADA", "CHECKIN"], "NO_SHOW"))) throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita no se puede marcar", 409);
    await evento(c.id, "NO_SHOW", { manual: true }, actor);
    await aplicarBloqueo(c.localId, c.clienteId, c.colaId);
  }
  if (accion === "ASISTIO") {
    // Registro manual de asistencia (p. ej. atendida fuera del sistema de turnos)
    if (!(await cambiarEstado(c.id, ["RESERVADA", "CONFIRMADA", "CHECKIN"].filter((e) => e === c.estado) as EstadoCita[], "ATENDIDA"))) {
      throw new ErrorNegocio("M3_ESTADO_INVALIDO", "La cita no se puede marcar como atendida", 409);
    }
    await evento(c.id, "ATENDIDA", { manual: true }, actor);
  }
  publicar({ tipo: "cita:estado", localId, cita: { id: c.id, token: c.token, estado: accion } });
  return prisma.cita.findUniqueOrThrow({ where: { id: c.id } });
}

export async function guardarConfig(localId: number, colaId: number, datos: Partial<Omit<ConfigCitas, "colaId">>) {
  const cola = await prisma.cola.findFirst({ where: { id: colaId, localId }, include: { local: { include: { plan: true } } } });
  if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  // Matriz §7: EMPRENDE permite citas en 1 cola
  if (datos.activo && cola.local.plan.codigo === "EMPRENDE") {
    const otras = await prisma.configCitas.count({ where: { activo: true, colaId: { not: colaId }, cola: { localId } } });
    if (otras >= 1) throw new ErrorNegocio("M3_LIMITE_PLAN", "El plan Emprende permite citas en 1 servicio", 402);
  }
  const cfg = await prisma.configCitas.upsert({ where: { colaId }, create: { colaId, ...datos }, update: datos });
  if (datos.pesoCita !== undefined) {
    await prisma.categoriaPrioridad.updateMany({ where: { localId, codigo: "CITA" }, data: { pesoBase: datos.pesoCita } });
  }
  return cfg;
}

export async function listarBloqueos(localId: number) {
  const [agendaB, clientes] = await Promise.all([
    prisma.bloqueoAgenda.findMany({ where: { localId, fin: { gt: new Date() } }, orderBy: { inicio: "asc" }, include: { cola: { select: { nombre: true } } } }),
    prisma.bloqueoCliente.findMany({ where: { localId, hasta: { gt: new Date() }, liberadoPor: null }, include: { cliente: { select: { nombre: true } } } }),
  ]);
  return { agenda: agendaB, clientes: clientes.map((b) => ({ id: b.id, clienteId: b.clienteId, nombre: b.cliente.nombre, hasta: b.hasta, motivo: b.motivo })) };
}

export async function crearBloqueoAgenda(localId: number, d: { colaId?: number | null; inicio: Date; fin: Date; motivo: string }) {
  if (d.fin <= d.inicio) throw new ErrorNegocio("VALIDACION", "El fin debe ser posterior al inicio", 422);
  if (d.colaId) {
    const cola = await prisma.cola.findFirst({ where: { id: d.colaId, localId } });
    if (!cola) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe", 404);
  }
  const b = await prisma.bloqueoAgenda.create({ data: { localId, colaId: d.colaId ?? null, inicio: d.inicio, fin: d.fin, motivo: d.motivo } });
  // Los slots futuros sin reservas que caen en el bloqueo se eliminan (RN-M3-09: nunca los que tienen reservas)
  await prisma.slot.deleteMany({ where: { reservados: 0, inicio: { lt: d.fin }, fin: { gt: d.inicio }, cola: { localId }, ...(d.colaId ? { colaId: d.colaId } : {}) } });
  return b;
}

export async function eliminarBloqueoAgenda(localId: number, id: number) {
  const r = await prisma.bloqueoAgenda.deleteMany({ where: { id, localId } });
  if (!r.count) throw new ErrorNegocio("NO_ENCONTRADO", "El bloqueo no existe", 404);
}

export async function liberarCliente(localId: number, bloqueoId: number, usuarioId: number) {
  const r = await prisma.bloqueoCliente.updateMany({ where: { id: bloqueoId, localId, liberadoPor: null }, data: { liberadoPor: usuarioId } });
  if (!r.count) throw new ErrorNegocio("NO_ENCONTRADO", "El bloqueo no existe", 404);
}

/** Para el bot (M4): fechas con cupo y horarios del día. */
export async function colasConCitas(localId: number) {
  return prisma.cola.findMany({ where: { localId, activa: true, configCitas: { activo: true } }, select: { id: true, nombre: true }, orderBy: { orden: "asc" } });
}

export function logCita(msg: string, datos: Record<string, unknown>) {
  log.info(msg, { modulo: "M3", ...datos });
}
