import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { publicar } from "@/lib/realtime";
import { descifrar } from "@/lib/crypto";
import { enviarAviso } from "@/lib/notificaciones";
import { fechaLocalISO, instanteLocal, minutosDe, partesLocales, sumarDiasISO, fechaADate } from "@/lib/fechas";

/** Operación del núcleo: horario del local (N05), expiración de llamados (N04/RN04) y valoración (N07). */

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * N05 · ¿Está abierto el local ahora? Sin horarios definidos ⇒ siempre abierto (comportamiento original).
 * Devuelve también la próxima apertura para mostrar "Abrimos el lunes a las 08:00".
 */
export async function localAbierto(localId: number, zona: string, ahora = new Date()) {
  const horarios = await prisma.horarioLocal.findMany({ where: { localId, activo: true } });
  if (horarios.length === 0) return { abierto: true, mensaje: null as string | null, proximaApertura: null as string | null };
  const { diaSemana, hora, minuto } = partesLocales(zona, ahora);
  const mins = hora * 60 + minuto;
  const hoy = horarios.find((h) => h.diaSemana === diaSemana);
  const abierto = !!hoy && mins >= minutosDe(hoy.apertura) && mins < minutosDe(hoy.cierre);
  if (abierto) return { abierto: true, mensaje: null, proximaApertura: null };

  // Próxima apertura (hoy más tarde o los próximos 7 días)
  const hoyISO = fechaLocalISO(zona, ahora);
  for (let d = 0; d < 8; d++) {
    const dia = (diaSemana + d) % 7;
    const h = horarios.find((x) => x.diaSemana === dia);
    if (!h) continue;
    if (d === 0 && mins >= minutosDe(h.apertura)) continue;
    const [hh, mm] = h.apertura.split(":").map(Number);
    const proxima = instanteLocal(sumarDiasISO(hoyISO, d), hh, mm, zona);
    const cuando = d === 0 ? "hoy" : d === 1 ? "mañana" : `el ${DIAS[dia]}`;
    return { abierto: false, mensaje: `Estamos cerrados. Abrimos ${cuando} a las ${h.apertura}.`, proximaApertura: proxima.toISOString() };
  }
  return { abierto: false, mensaje: "Hoy no atendemos.", proximaApertura: null };
}

/**
 * N04 · RN04: un turno LLAMADO que no se presenta en `local.tiempo_ausencia_seg` pasa a NO_SE_PRESENTO.
 * Es opt-in por local (NULL = desactivado). Avisa al cliente con "tu turno venció".
 */
export async function expirarLlamados(ahora = new Date()) {
  const locales = await prisma.local.findMany({ where: { activo: true, tiempoAusenciaSeg: { not: null } }, select: { id: true, tiempoAusenciaSeg: true, nombreComercial: true } });
  let n = 0;
  for (const local of locales) {
    const limite = new Date(ahora.getTime() - (local.tiempoAusenciaSeg ?? 180) * 1000);
    const vencidos = await prisma.turno.findMany({ where: { localId: local.id, estado: "LLAMADO", llamadoAt: { lte: limite } }, include: { cliente: true } });
    for (const t of vencidos) {
      const r = await prisma.turno.updateMany({ where: { id: t.id, estado: "LLAMADO" }, data: { estado: "NO_SE_PRESENTO", finalizadoAt: ahora } });
      if (r.count === 0) continue;
      publicar({ tipo: "turno:estado", localId: local.id, turno: { id: t.id, token: t.token, estado: "NO_SE_PRESENTO" } });
      publicar({ tipo: "cola:actualizada", localId: local.id, colaId: t.colaId });
      const telefono = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
      if (telefono) {
        void enviarAviso({
          localId: local.id,
          turnoId: t.id,
          telefonoE164: telefono,
          plantilla: "turno_vencido",
          texto: `Tu turno *${t.codigo}* en *${local.nombreComercial}* venció porque no te presentaste a tiempo. Puedes tomar uno nuevo desde el enlace del local.`,
        }).catch(() => {});
      }
      const { alCerrarTurno } = await import("@/lib/turnos");
      void alCerrarTurno(t.id, "NO_SE_PRESENTO").catch(() => {});
      n++;
    }
  }
  return n;
}

export async function valorarTurno(token: string, estrellas: number, comentario?: string | null) {
  const turno = await prisma.turno.findUnique({ where: { token } });
  if (!turno || turno.estado !== "ATENDIDO") throw new ErrorNegocio("VALIDACION", "Solo se valora un turno ya atendido", 409);
  const previa = await prisma.valoracion.findUnique({ where: { turnoId: turno.id } });
  if (previa) throw new ErrorNegocio("M7_VALORACION_DUPLICADA", "Este turno ya fue valorado", 409);
  const limpio = comentario?.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 280) || null;
  return prisma.valoracion.create({ data: { turnoId: turno.id, estrellas, comentario: limpio } });
}

export function fechaHoy(zona: string) {
  return fechaADate(fechaLocalISO(zona));
}
