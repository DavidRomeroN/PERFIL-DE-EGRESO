import { prisma } from "@/lib/db";
import { publicar } from "@/lib/realtime";
import {
  cifrar,
  descifrar,
  enmascararTelefono,
  generarToken,
  hashTelefono,
  normalizarTelefono,
} from "@/lib/crypto";
import { proveedorWhatsApp, renderTurnoLlamado, renderTurnoProximo } from "@/lib/whatsapp";
import type { EstadoTurno, Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Errores de negocio
// ---------------------------------------------------------------------------

export class ErrorNegocio extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status = 400,
    public extra?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}

// ---------------------------------------------------------------------------
// Utilidades de fecha (zona horaria del local)
// ---------------------------------------------------------------------------

export function fechaLocalISO(zona = "America/Lima", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Fecha local (ISO yyyy-mm-dd) de hace N días. */
export function fechaLocalHaceDias(dias: number, zona = "America/Lima"): string {
  return fechaLocalISO(zona, new Date(Date.now() - dias * 86400000));
}

export function fechaADate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const ACTIVOS: EstadoTurno[] = ["EMITIDO", "AVISADO", "LLAMADO"];
const EN_ESPERA: EstadoTurno[] = ["EMITIDO", "AVISADO"];

/** Diagrama de estados del turno (sección 8.6). */
const TRANSICIONES: Record<EstadoTurno, EstadoTurno[]> = {
  EMITIDO: ["AVISADO", "LLAMADO", "CANCELADO"],
  AVISADO: ["LLAMADO", "CANCELADO"],
  LLAMADO: ["LLAMADO", "ATENDIDO", "NO_SE_PRESENTO"],
  ATENDIDO: [],
  NO_SE_PRESENTO: [],
  CANCELADO: [],
};

export function transicionValida(desde: EstadoTurno, hacia: EstadoTurno) {
  return TRANSICIONES[desde].includes(hacia);
}

// ---------------------------------------------------------------------------
// Emisión de turno (RF01, RF07) — RN01, RN03, RN05
// ---------------------------------------------------------------------------

export interface EmitirTurnoInput {
  colaId: number;
  nombre?: string | null;
  telefono?: string | null;
  consentimiento?: boolean;
  canal: "QR" | "TICKET";
}

export async function emitirTurno(input: EmitirTurnoInput) {
  const cola = await prisma.cola.findUnique({
    where: { id: input.colaId },
    include: { local: { include: { plan: true } } },
  });
  if (!cola || !cola.activa) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe o está inactiva", 404);
  if (!cola.local.activo) throw new ErrorNegocio("LOCAL_INACTIVO", "El local está inactivo", 403);

  const fechaISO = fechaLocalISO(cola.local.zonaHoraria);

  // RN05: límite mensual del plan
  const inicioMes = fechaADate(`${fechaISO.slice(0, 7)}-01`);
  const turnosMes = await prisma.turno.count({ where: { localId: cola.localId, fecha: { gte: inicioMes } } });
  if (turnosMes >= cola.local.plan.maxTurnosMes) {
    throw new ErrorNegocio("LIMITE_PLAN", `El plan ${cola.local.plan.nombre} permite hasta ${cola.local.plan.maxTurnosMes} turnos al mes`, 402);
  }

  // Cliente (dato personal mínimo, cifrado)
  let clienteId: number | null = null;
  const telefonoE164 = input.telefono ? normalizarTelefono(input.telefono) : null;
  if (input.telefono && !telefonoE164) throw new ErrorNegocio("TELEFONO_INVALIDO", "El celular no es válido (9 dígitos, ej. 951234567)");
  if (telefonoE164 && !input.consentimiento) {
    throw new ErrorNegocio("CONSENTIMIENTO_REQUERIDO", "Debes aceptar la política de datos para recibir avisos por WhatsApp");
  }
  const nombre = input.nombre?.trim() ? input.nombre.trim().slice(0, 60) : null;

  if (telefonoE164) {
    const hash = hashTelefono(telefonoE164);
    const existente = await prisma.cliente.findFirst({ where: { telefonoHash: hash } });
    if (existente) {
      clienteId = existente.id;
      if (nombre && nombre !== existente.nombre) {
        await prisma.cliente.update({ where: { id: existente.id }, data: { nombre, consentimientoAt: new Date() } });
      }
      // RN03: un celular solo puede tener 1 turno activo por cola
      const activo = await prisma.turno.findFirst({
        where: { colaId: cola.id, clienteId: existente.id, estado: { in: ACTIVOS } },
        select: { codigo: true, token: true },
      });
      if (activo) {
        throw new ErrorNegocio("TURNO_DUPLICADO", `Este celular ya tiene el turno ${activo.codigo} activo en esta cola`, 409, {
          token: activo.token,
          codigo: activo.codigo,
        });
      }
    } else {
      const c = await prisma.cliente.create({
        data: { telefonoHash: hash, telefonoCifrado: cifrar(telefonoE164), nombre },
      });
      clienteId = c.id;
    }
  } else if (nombre) {
    const c = await prisma.cliente.create({ data: { nombre } });
    clienteId = c.id;
  }

  // Emisión transaccional en la BD (función emitir_turno, sección 9.3)
  const token = generarToken(10);
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM emitir_turno(${cola.id}::int, ${clienteId}::int, ${input.canal}::text, ${token}::text, ${fechaADate(fechaISO)}::date)
  `;
  const turnoId = rows[0]?.id;
  if (!turnoId) throw new ErrorNegocio("ERROR_EMISION", "No se pudo emitir el turno", 500);

  publicar({ tipo: "cola:actualizada", localId: cola.localId, colaId: cola.id });
  // Si la cola está casi vacía, el aviso puede corresponder de inmediato
  void revisarAvisos(cola.id).catch(() => {});

  return obtenerTurnoPorToken(token);
}

// ---------------------------------------------------------------------------
// Consulta de estado del turno (RF02)
// ---------------------------------------------------------------------------

export async function obtenerTurnoPorToken(token: string) {
  const turno = await prisma.turno.findUnique({
    where: { token },
    include: {
      cola: { select: { id: true, nombre: true, prefijo: true, tiempoAtencionBase: true } },
      ventanilla: { select: { id: true, nombre: true } },
      cliente: { select: { nombre: true, telefonoCifrado: true } },
      local: { select: { id: true, slug: true, nombreComercial: true, colorPrimario: true, logoUrl: true, direccion: true, avisarFaltando: true } },
      notificaciones: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);

  let posicion = 0;
  let tiempoEstimadoSeg = 0;
  if (EN_ESPERA.includes(turno.estado)) {
    const delante = await prisma.turno.count({
      where: { colaId: turno.colaId, fecha: turno.fecha, estado: { in: EN_ESPERA }, emitidoAt: { lt: turno.emitidoAt } },
    });
    posicion = delante + 1;
    tiempoEstimadoSeg = await tiempoEstimado(turno.colaId, posicion);
  }

  const llamandoAhora = await prisma.turno.findMany({
    where: { colaId: turno.colaId, fecha: turno.fecha, estado: "LLAMADO" },
    orderBy: { llamadoAt: "desc" },
    take: 3,
    select: { codigo: true, ventanilla: { select: { nombre: true } } },
  });

  const telefono = turno.cliente?.telefonoCifrado ? descifrar(turno.cliente.telefonoCifrado) : null;

  return {
    id: turno.id,
    codigo: turno.codigo,
    token: turno.token,
    estado: turno.estado,
    canal: turno.canal,
    numero: turno.numero,
    posicion,
    personasDelante: Math.max(0, posicion - 1),
    tiempoEstimadoSeg,
    rellamadas: turno.rellamadas,
    emitidoAt: turno.emitidoAt,
    avisadoAt: turno.avisadoAt,
    llamadoAt: turno.llamadoAt,
    finalizadoAt: turno.finalizadoAt,
    fecha: turno.fecha.toISOString().slice(0, 10),
    cola: turno.cola,
    ventanilla: turno.ventanilla,
    cliente: { nombre: turno.cliente?.nombre ?? null, telefonoMasc: telefono ? enmascararTelefono(telefono) : null },
    local: turno.local,
    llamandoAhora: llamandoAhora.map((t) => ({ codigo: t.codigo, ventanilla: t.ventanilla?.nombre ?? "" })),
    notificaciones: turno.notificaciones.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      destino: n.destino,
      mensaje: n.mensaje,
      estado: n.estado,
      enviadoAt: n.enviadoAt,
      createdAt: n.createdAt,
    })),
    urlSeguimiento: `${appUrl()}/t/${turno.token}`,
  };
}

export type TurnoPublico = Awaited<ReturnType<typeof obtenerTurnoPorToken>>;

/** RN02 — usa la función SQL tiempo_estimado(cola, posicion). */
export async function tiempoEstimado(colaId: number, posicion: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ seg: number }[]>`SELECT tiempo_estimado(${colaId}::int, ${posicion}::int) AS seg`;
  return Number(rows[0]?.seg ?? 0);
}

// ---------------------------------------------------------------------------
// Cancelación por el cliente (RF04)
// ---------------------------------------------------------------------------

export async function cancelarTurno(token: string) {
  const turno = await prisma.turno.findUnique({ where: { token } });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
  if (!transicionValida(turno.estado, "CANCELADO")) {
    throw new ErrorNegocio("TRANSICION_INVALIDA", `No se puede cancelar un turno en estado ${turno.estado}`, 409);
  }
  await prisma.turno.update({ where: { id: turno.id }, data: { estado: "CANCELADO", finalizadoAt: new Date() } });
  publicar({ tipo: "turno:estado", localId: turno.localId, turno: { id: turno.id, token: turno.token, estado: "CANCELADO" } });
  publicar({ tipo: "cola:actualizada", localId: turno.localId, colaId: turno.colaId });
  void revisarAvisos(turno.colaId).catch(() => {});
  return obtenerTurnoPorToken(token);
}

// ---------------------------------------------------------------------------
// Operación de ventanilla (RF05, RF06)
// ---------------------------------------------------------------------------

export async function llamarSiguiente(ventanillaId: number, localId: number) {
  const ventanilla = await prisma.ventanilla.findFirst({ where: { id: ventanillaId, localId }, include: { local: true } });
  if (!ventanilla || !ventanilla.activa) throw new ErrorNegocio("VENTANILLA_INVALIDA", "La ventanilla no existe o está inactiva", 404);

  const fecha = fechaADate(fechaLocalISO(ventanilla.local.zonaHoraria));
  const ahora = new Date();

  const resultado = await prisma.$transaction(async (tx) => {
    // El turno que estaba en esta ventanilla pasa a ATENDIDO (cierre implícito)
    const enCurso = await tx.turno.findFirst({ where: { ventanillaId, estado: "LLAMADO" } });
    if (enCurso) {
      await tx.turno.update({
        where: { id: enCurso.id },
        data: { estado: "ATENDIDO", atendidoAt: enCurso.atendidoAt ?? ahora, finalizadoAt: ahora },
      });
    }

    const where: Prisma.TurnoWhereInput = {
      localId,
      fecha,
      estado: { in: EN_ESPERA },
      ...(ventanilla.colaId ? { colaId: ventanilla.colaId } : {}),
    };
    const siguiente = await tx.turno.findFirst({ where, orderBy: [{ emitidoAt: "asc" }], include: { cola: true } });
    if (!siguiente) return { cerrado: enCurso, llamado: null };

    const llamado = await tx.turno.update({
      where: { id: siguiente.id },
      data: { estado: "LLAMADO", ventanillaId, llamadoAt: ahora, avisadoAt: siguiente.avisadoAt ?? ahora },
      include: { cola: true, cliente: true },
    });
    return { cerrado: enCurso, llamado };
  });

  if (resultado.cerrado) {
    publicar({ tipo: "turno:estado", localId, turno: { id: resultado.cerrado.id, token: resultado.cerrado.token, estado: "ATENDIDO" } });
  }
  if (resultado.llamado) {
    const t = resultado.llamado;
    publicar({
      tipo: "turno:llamado",
      localId,
      turno: { id: t.id, codigo: t.codigo, token: t.token, ventanilla: ventanilla.nombre, cola: t.cola.nombre, rellamada: false },
    });
    publicar({ tipo: "turno:estado", localId, turno: { id: t.id, token: t.token, estado: "LLAMADO" } });
    void notificarLlamado(t.id, ventanilla.nombre).catch(() => {});
    void revisarAvisos(t.colaId).catch(() => {});
  }
  publicar({ tipo: "cola:actualizada", localId });

  return resultado.llamado ? obtenerTurnoPorToken(resultado.llamado.token) : null;
}

export async function cambiarEstadoTurno(turnoId: number, localId: number, nuevo: EstadoTurno) {
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, localId }, include: { ventanilla: true, cola: true } });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
  if (!transicionValida(turno.estado, nuevo)) {
    throw new ErrorNegocio("TRANSICION_INVALIDA", `Transición ${turno.estado} → ${nuevo} no permitida`, 409);
  }
  const ahora = new Date();
  const data: Prisma.TurnoUpdateInput = { estado: nuevo };
  if (nuevo === "LLAMADO") {
    data.rellamadas = { increment: 1 };
    data.llamadoAt = ahora;
  }
  if (nuevo === "ATENDIDO") {
    data.atendidoAt = turno.atendidoAt ?? ahora;
    data.finalizadoAt = ahora;
  }
  if (nuevo === "NO_SE_PRESENTO" || nuevo === "CANCELADO") data.finalizadoAt = ahora;

  const actualizado = await prisma.turno.update({ where: { id: turno.id }, data });

  if (nuevo === "LLAMADO") {
    publicar({
      tipo: "turno:llamado",
      localId,
      turno: { id: turno.id, codigo: turno.codigo, token: turno.token, ventanilla: turno.ventanilla?.nombre ?? "", cola: turno.cola.nombre, rellamada: true },
    });
  }
  publicar({ tipo: "turno:estado", localId, turno: { id: turno.id, token: turno.token, estado: nuevo } });
  publicar({ tipo: "cola:actualizada", localId, colaId: turno.colaId });
  return actualizado;
}

// ---------------------------------------------------------------------------
// Avisos (RF03) — "cuando falten N personas" (local.avisarFaltando)
// ---------------------------------------------------------------------------

export async function revisarAvisos(colaId: number) {
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, include: { local: { include: { plan: true } } } });
  if (!cola) return;
  const fecha = fechaADate(fechaLocalISO(cola.local.zonaHoraria));
  const espera = await prisma.turno.findMany({
    where: { colaId, fecha, estado: { in: EN_ESPERA } },
    orderBy: { emitidoAt: "asc" },
    include: { cliente: true },
  });

  for (let i = 0; i < espera.length; i++) {
    const t = espera[i];
    const delante = i; // personas antes que él
    if (delante > cola.local.avisarFaltando) break;
    if (t.estado !== "EMITIDO") continue;

    const telefono = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
    const url = `${appUrl()}/t/${t.token}`;
    const mensaje = renderTurnoProximo({ nombre: t.cliente?.nombre, codigo: t.codigo, local: cola.local.nombreComercial, faltan: delante, url });

    await prisma.turno.update({ where: { id: t.id }, data: { estado: "AVISADO", avisadoAt: new Date() } });

    const usaWhatsApp = !!telefono && cola.local.plan.whatsappHabilitado;
    const notif = await prisma.notificacion.create({
      data: {
        turnoId: t.id,
        tipo: usaWhatsApp ? "WHATSAPP" : "WEB",
        destino: telefono ? enmascararTelefono(telefono) : null,
        mensaje,
        plantilla: usaWhatsApp ? "turno_proximo" : null,
        estado: usaWhatsApp ? "PENDIENTE" : "ENTREGADO",
        enviadoAt: usaWhatsApp ? null : new Date(),
        error: telefono && !usaWhatsApp ? "Plan sin WhatsApp (RN05): aviso solo por web" : null,
      },
    });

    publicar({ tipo: "turno:estado", localId: cola.localId, turno: { id: t.id, token: t.token, estado: "AVISADO" } });

    if (usaWhatsApp && telefono) {
      void enviarNotificacion(notif.id, telefono, "turno_proximo", [t.codigo, cola.local.nombreComercial], mensaje, cola.localId).catch(() => {});
    } else {
      publicar({ tipo: "notificacion:nueva", localId: cola.localId, notificacion: { id: notif.id, turnoId: t.id, mensaje, destino: notif.destino } });
    }
  }
  publicar({ tipo: "cola:actualizada", localId: cola.localId, colaId });
}

async function notificarLlamado(turnoId: number, ventanilla: string) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, include: { cliente: true, local: { include: { plan: true } } } });
  if (!t) return;
  const telefono = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
  if (!telefono || !t.local.plan.whatsappHabilitado) return;
  const mensaje = renderTurnoLlamado({ codigo: t.codigo, ventanilla, local: t.local.nombreComercial });
  const notif = await prisma.notificacion.create({
    data: { turnoId, tipo: "WHATSAPP", destino: enmascararTelefono(telefono), mensaje, plantilla: "turno_llamado", estado: "PENDIENTE" },
  });
  await enviarNotificacion(notif.id, telefono, "turno_llamado", [t.codigo, ventanilla], mensaje, t.localId);
}

async function enviarNotificacion(notifId: number, telefonoE164: string, plantilla: string, parametros: string[], texto: string, localId: number) {
  const proveedor = proveedorWhatsApp();
  const r = await proveedor.enviar({ telefonoE164, plantilla, parametros, textoRenderizado: texto });
  const n = await prisma.notificacion.update({
    where: { id: notifId },
    data: r.ok
      ? { estado: "ENVIADO", proveedorMsgId: r.proveedorMsgId, enviadoAt: new Date() }
      : { estado: "FALLIDO", error: r.error },
  });
  publicar({ tipo: "notificacion:nueva", localId, notificacion: { id: n.id, turnoId: n.turnoId, mensaje: n.mensaje, destino: n.destino } });

  // En modo simulador, emulamos el webhook de estado de Meta (entregado → leído)
  if (r.ok && proveedor.nombre === "mock") {
    setTimeout(async () => {
      await prisma.notificacion.update({ where: { id: notifId }, data: { estado: "ENTREGADO" } }).catch(() => {});
      publicar({ tipo: "notificacion:nueva", localId, notificacion: { id: n.id, turnoId: n.turnoId, mensaje: n.mensaje, destino: n.destino } });
    }, 1500);
    setTimeout(async () => {
      await prisma.notificacion.update({ where: { id: notifId }, data: { estado: "LEIDO" } }).catch(() => {});
      publicar({ tipo: "notificacion:nueva", localId, notificacion: { id: n.id, turnoId: n.turnoId, mensaje: n.mensaje, destino: n.destino } });
    }, 4000);
  }
}

// ---------------------------------------------------------------------------
// Snapshot del local (pantalla TV, panel de ventanilla)
// ---------------------------------------------------------------------------

export async function snapshotLocal(slug: string, opciones: { incluirNombres?: boolean } = {}) {
  const local = await prisma.local.findUnique({
    where: { slug },
    include: {
      plan: true,
      colas: { where: { activa: true }, orderBy: { orden: "asc" }, include: { ventanillas: { where: { activa: true } } } },
      ventanillas: { where: { activa: true }, orderBy: { id: "asc" }, include: { cola: { select: { id: true, nombre: true, prefijo: true } } } },
    },
  });
  if (!local || !local.activo) throw new ErrorNegocio("LOCAL_NO_ENCONTRADO", "El local no existe", 404);

  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria));
  const turnosHoy = await prisma.turno.findMany({
    where: { localId: local.id, fecha },
    orderBy: { emitidoAt: "asc" },
    include: { cliente: { select: { nombre: true } }, ventanilla: { select: { id: true, nombre: true } } },
  });

  const colas = await Promise.all(
    local.colas.map(async (c) => {
      const propios = turnosHoy.filter((t) => t.colaId === c.id);
      const espera = propios.filter((t) => EN_ESPERA.includes(t.estado));
      const llamados = propios.filter((t) => t.estado === "LLAMADO").sort((a, b) => (b.llamadoAt?.getTime() ?? 0) - (a.llamadoAt?.getTime() ?? 0));
      const estimadoSiguiente = espera.length ? await tiempoEstimado(c.id, 1) : 0;
      const atendidosHoy = propios.filter((t) => t.estado === "ATENDIDO");
      const esperaProm = promedioMin(atendidosHoy.map((t) => (t.llamadoAt && t.emitidoAt ? t.llamadoAt.getTime() - t.emitidoAt.getTime() : null)));
      return {
        id: c.id,
        nombre: c.nombre,
        prefijo: c.prefijo,
        descripcion: c.descripcion,
        ventanillas: c.ventanillas.map((v) => ({ id: v.id, nombre: v.nombre })),
        enEspera: espera.length,
        tiempoEstimadoSeg: estimadoSiguiente,
        esperaPromedioMin: esperaProm,
        espera: espera.map((t, i) => ({
          id: t.id,
          codigo: t.codigo,
          token: t.token,
          estado: t.estado,
          canal: t.canal,
          emitidoAt: t.emitidoAt,
          posicion: i + 1,
          nombre: opciones.incluirNombres ? t.cliente?.nombre ?? null : null,
        })),
        llamados: llamados.map((t) => ({
          id: t.id,
          codigo: t.codigo,
          token: t.token,
          ventanilla: t.ventanilla?.nombre ?? "",
          ventanillaId: t.ventanillaId,
          llamadoAt: t.llamadoAt,
          rellamadas: t.rellamadas,
          nombre: opciones.incluirNombres ? t.cliente?.nombre ?? null : null,
        })),
      };
    }),
  );

  const ultimosLlamados = turnosHoy
    .filter((t) => t.llamadoAt && t.estado !== "CANCELADO")
    .sort((a, b) => (b.llamadoAt?.getTime() ?? 0) - (a.llamadoAt?.getTime() ?? 0))
    .slice(0, 8)
    .map((t) => ({ id: t.id, codigo: t.codigo, ventanilla: t.ventanilla?.nombre ?? "", estado: t.estado, llamadoAt: t.llamadoAt }));

  const total = turnosHoy.length;
  const atendidos = turnosHoy.filter((t) => t.estado === "ATENDIDO").length;
  const noPresentados = turnosHoy.filter((t) => t.estado === "NO_SE_PRESENTO").length;
  const cancelados = turnosHoy.filter((t) => t.estado === "CANCELADO").length;
  const enEspera = turnosHoy.filter((t) => EN_ESPERA.includes(t.estado)).length;
  const porQR = turnosHoy.filter((t) => t.canal === "QR").length;
  const esperaPromedioMin = promedioMin(turnosHoy.filter((t) => t.llamadoAt).map((t) => t.llamadoAt!.getTime() - t.emitidoAt.getTime()));
  const atencionPromedioMin = promedioMin(
    turnosHoy.filter((t) => t.estado === "ATENDIDO" && t.finalizadoAt && t.llamadoAt).map((t) => t.finalizadoAt!.getTime() - t.llamadoAt!.getTime()),
  );

  return {
    local: {
      id: local.id,
      slug: local.slug,
      nombreComercial: local.nombreComercial,
      direccion: local.direccion,
      colorPrimario: local.colorPrimario,
      logoUrl: local.logoUrl,
      mensajeTv: local.mensajeTv,
      mensajeBienvenida: local.mensajeBienvenida,
      plan: { codigo: local.plan.codigo, nombre: local.plan.nombre, whatsappHabilitado: local.plan.whatsappHabilitado },
      avisarFaltando: local.avisarFaltando,
    },
    fecha: fecha.toISOString().slice(0, 10),
    ventanillas: local.ventanillas.map((v) => ({ id: v.id, nombre: v.nombre, cola: v.cola })),
    colas,
    ultimosLlamados,
    stats: {
      total,
      atendidos,
      noPresentados,
      cancelados,
      enEspera,
      llamados: turnosHoy.filter((t) => t.estado === "LLAMADO").length,
      porQR,
      pctQR: total ? Math.round((porQR / total) * 100) : 0,
      tasaAbandono: total ? Math.round(((noPresentados + cancelados) / total) * 1000) / 10 : 0,
      esperaPromedioMin,
      atencionPromedioMin,
    },
    generadoAt: new Date(),
  };
}

export type SnapshotLocal = Awaited<ReturnType<typeof snapshotLocal>>;

function promedioMin(valoresMs: (number | null)[]) {
  const v = valoresMs.filter((x): x is number => typeof x === "number" && x >= 0);
  if (!v.length) return 0;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length / 60000) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Reportes (RF09)
// ---------------------------------------------------------------------------

export async function reporteEspera(localId: number, desdeISO: string, hastaISO: string) {
  const desde = fechaADate(desdeISO);
  const hasta = fechaADate(hastaISO);
  const turnos = await prisma.turno.findMany({
    where: { localId, fecha: { gte: desde, lte: hasta } },
    include: { cola: { select: { id: true, nombre: true, prefijo: true } }, ventanilla: { select: { nombre: true } } },
    orderBy: { emitidoAt: "asc" },
  });

  const total = turnos.length;
  const atendidos = turnos.filter((t) => t.estado === "ATENDIDO");
  const noPresentados = turnos.filter((t) => t.estado === "NO_SE_PRESENTO").length;
  const cancelados = turnos.filter((t) => t.estado === "CANCELADO").length;
  const porQR = turnos.filter((t) => t.canal === "QR").length;

  const esperaMs = turnos.filter((t) => t.llamadoAt).map((t) => t.llamadoAt!.getTime() - t.emitidoAt.getTime());
  const atencionMs = atendidos.filter((t) => t.finalizadoAt && t.llamadoAt).map((t) => t.finalizadoAt!.getTime() - t.llamadoAt!.getTime());

  // Por día
  const porDiaMap = new Map<string, { fecha: string; turnos: number; atendidos: number; abandonos: number; esperaMs: number[] }>();
  for (const t of turnos) {
    const k = t.fecha.toISOString().slice(0, 10);
    const d = porDiaMap.get(k) ?? { fecha: k, turnos: 0, atendidos: 0, abandonos: 0, esperaMs: [] };
    d.turnos++;
    if (t.estado === "ATENDIDO") d.atendidos++;
    if (t.estado === "NO_SE_PRESENTO" || t.estado === "CANCELADO") d.abandonos++;
    if (t.llamadoAt) d.esperaMs.push(t.llamadoAt.getTime() - t.emitidoAt.getTime());
    porDiaMap.set(k, d);
  }
  const porDia = [...porDiaMap.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((d) => ({ fecha: d.fecha, turnos: d.turnos, atendidos: d.atendidos, abandonos: d.abandonos, esperaPromMin: promedioMin(d.esperaMs) }));

  // Por hora (zona horaria Lima)
  const horaDe = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(d)) % 24;
  const porHoraMap = new Map<number, { hora: number; turnos: number; esperaMs: number[] }>();
  for (const t of turnos) {
    const h = horaDe(t.emitidoAt);
    const d = porHoraMap.get(h) ?? { hora: h, turnos: 0, esperaMs: [] };
    d.turnos++;
    if (t.llamadoAt) d.esperaMs.push(t.llamadoAt.getTime() - t.emitidoAt.getTime());
    porHoraMap.set(h, d);
  }
  const porHora = Array.from({ length: 24 }, (_, h) => {
    const d = porHoraMap.get(h);
    return { hora: h, etiqueta: `${String(h).padStart(2, "0")}:00`, turnos: d?.turnos ?? 0, esperaPromMin: d ? promedioMin(d.esperaMs) : 0 };
  }).filter((x) => x.hora >= 6 && x.hora <= 21);

  // Por cola
  const porColaMap = new Map<number, { cola: string; prefijo: string; turnos: number; atendidos: number; abandonos: number; esperaMs: number[]; atencionMs: number[] }>();
  for (const t of turnos) {
    const d = porColaMap.get(t.colaId) ?? { cola: t.cola.nombre, prefijo: t.cola.prefijo, turnos: 0, atendidos: 0, abandonos: 0, esperaMs: [], atencionMs: [] };
    d.turnos++;
    if (t.estado === "ATENDIDO") {
      d.atendidos++;
      if (t.finalizadoAt && t.llamadoAt) d.atencionMs.push(t.finalizadoAt.getTime() - t.llamadoAt.getTime());
    }
    if (t.estado === "NO_SE_PRESENTO" || t.estado === "CANCELADO") d.abandonos++;
    if (t.llamadoAt) d.esperaMs.push(t.llamadoAt.getTime() - t.emitidoAt.getTime());
    porColaMap.set(t.colaId, d);
  }
  const porCola = [...porColaMap.values()].map((d) => ({
    cola: d.cola,
    prefijo: d.prefijo,
    turnos: d.turnos,
    atendidos: d.atendidos,
    abandonos: d.abandonos,
    tasaAbandono: d.turnos ? Math.round((d.abandonos / d.turnos) * 1000) / 10 : 0,
    esperaPromMin: promedioMin(d.esperaMs),
    atencionPromMin: promedioMin(d.atencionMs),
  }));

  const porEstado = (["EMITIDO", "AVISADO", "LLAMADO", "ATENDIDO", "NO_SE_PRESENTO", "CANCELADO"] as EstadoTurno[]).map((e) => ({
    estado: e,
    cantidad: turnos.filter((t) => t.estado === e).length,
  }));

  return {
    rango: { desde: desdeISO, hasta: hastaISO },
    resumen: {
      total,
      atendidos: atendidos.length,
      noPresentados,
      cancelados,
      tasaAbandono: total ? Math.round(((noPresentados + cancelados) / total) * 1000) / 10 : 0,
      pctQR: total ? Math.round((porQR / total) * 100) : 0,
      esperaPromMin: promedioMin(esperaMs),
      esperaMaxMin: esperaMs.length ? Math.round((Math.max(...esperaMs) / 60000) * 10) / 10 : 0,
      atencionPromMin: promedioMin(atencionMs),
    },
    porDia,
    porHora,
    porCola,
    porEstado,
    detalle: turnos.map((t) => ({
      id: t.id,
      fecha: t.fecha.toISOString().slice(0, 10),
      codigo: t.codigo,
      cola: t.cola.nombre,
      estado: t.estado,
      canal: t.canal,
      ventanilla: t.ventanilla?.nombre ?? "",
      emitidoAt: t.emitidoAt.toISOString(),
      llamadoAt: t.llamadoAt?.toISOString() ?? "",
      finalizadoAt: t.finalizadoAt?.toISOString() ?? "",
      esperaMin: t.llamadoAt ? Math.round(((t.llamadoAt.getTime() - t.emitidoAt.getTime()) / 60000) * 10) / 10 : "",
      atencionMin: t.finalizadoAt && t.llamadoAt && t.estado === "ATENDIDO" ? Math.round(((t.finalizadoAt.getTime() - t.llamadoAt.getTime()) / 60000) * 10) / 10 : "",
    })),
  };
}

export type ReporteEspera = Awaited<ReturnType<typeof reporteEspera>>;

/** RNF08 — borrado/anonimización de datos personales a los 90 días. */
export async function purgarDatosPersonales(dias = 90) {
  const limite = new Date(Date.now() - dias * 24 * 3600 * 1000);
  const r = await prisma.cliente.updateMany({
    where: { createdAt: { lt: limite }, OR: [{ telefonoCifrado: { not: null } }, { nombre: { not: null } }] },
    data: { telefonoCifrado: null, telefonoHash: null, nombre: null },
  });
  return r.count;
}
