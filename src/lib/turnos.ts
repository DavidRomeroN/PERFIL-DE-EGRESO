import { prisma } from "@/lib/db";
import { publicar } from "@/lib/realtime";
import { cifrar, descifrar, enmascararTelefono, generarToken, hashTelefono, normalizarTelefono } from "@/lib/crypto";
import { renderTurnoLlamado, renderTurnoProximo } from "@/lib/whatsapp";
import { enviarAviso } from "@/lib/notificaciones";
import { moduloActivo } from "@/lib/modulos";
import { contar, medir } from "@/lib/metricas";
import { log } from "@/lib/log";
import type { EstadoTurno, Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Errores de negocio
// ---------------------------------------------------------------------------

export { ErrorNegocio } from "@/lib/errores";
import { ErrorNegocio } from "@/lib/errores";

// ---------------------------------------------------------------------------
// Utilidades de fecha (zona horaria del local)
// ---------------------------------------------------------------------------

export { fechaLocalISO, fechaLocalHaceDias, fechaADate } from "@/lib/fechas";
import { fechaLocalISO, fechaADate, horaLocal } from "@/lib/fechas";

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const ACTIVOS: EstadoTurno[] = ["EMITIDO", "AVISADO", "LLAMADO"];
const EN_ESPERA: EstadoTurno[] = ["EMITIDO", "AVISADO"];

/** Diagrama de estados del turno (sección 8.6). M6 añade TRANSFERIDO también desde LLAMADO (RN-M6-01). */
const TRANSICIONES: Record<EstadoTurno, EstadoTurno[]> = {
  EMITIDO: ["AVISADO", "LLAMADO", "CANCELADO", "TRANSFERIDO"],
  AVISADO: ["LLAMADO", "CANCELADO", "TRANSFERIDO"],
  LLAMADO: ["LLAMADO", "ATENDIDO", "NO_SE_PRESENTO", "TRANSFERIDO"],
  ATENDIDO: [],
  NO_SE_PRESENTO: [],
  CANCELADO: [],
  TRANSFERIDO: [],
};

export function transicionValida(desde: EstadoTurno, hacia: EstadoTurno) {
  return TRANSICIONES[desde].includes(hacia);
}

// ---------------------------------------------------------------------------
// Emisión de turno (RF01, RF07) — RN01, RN03, RN05 · F5 (categoría, fecha de emisión, origen)
// ---------------------------------------------------------------------------

export type CanalEmision = "QR" | "TICKET" | "WHATSAPP" | "KIOSCO" | "CITA";

export interface EmitirTurnoInput {
  colaId: number;
  nombre?: string | null;
  telefono?: string | null;
  consentimiento?: boolean;
  canal: CanalEmision;
  categoriaCodigo?: string | null;
  origenCategoria?: "CLIENTE" | "PERSONAL" | "CITA";
  /** Cliente ya resuelto (cita, bot). Si se pasa, no se crea otro. */
  clienteId?: number | null;
  /** M3/M5/M6: hora de emisión efectiva (conserva el lugar en la fila). */
  emitidoAt?: Date | null;
  citaId?: number | null;
  dispositivoId?: number | null;
  codigoProvisional?: string | null;
  transferidoDe?: number | null;
  /** M3 check-in y M5 sincronización: el horario ya se validó con su propia regla. */
  omitirHorario?: boolean;
  /** M6: la transferencia no consume un turno nuevo del plan. */
  omitirLimitePlan?: boolean;
}

function origenPorCanal(canal: CanalEmision): "CLIENTE" | "PERSONAL" | "CITA" {
  return canal === "TICKET" ? "PERSONAL" : canal === "CITA" ? "CITA" : "CLIENTE";
}

/** Busca o crea el cliente a partir del celular (cifrado + hash) o solo el nombre. */
export async function resolverCliente(p: { telefono?: string | null; nombre?: string | null; consentimiento?: boolean }) {
  const telefonoE164 = p.telefono ? normalizarTelefono(p.telefono) : null;
  if (p.telefono && !telefonoE164) throw new ErrorNegocio("TELEFONO_INVALIDO", "El celular no es válido (9 dígitos, ej. 951234567)");
  if (telefonoE164 && !p.consentimiento) {
    throw new ErrorNegocio("CONSENTIMIENTO_REQUERIDO", "Debes aceptar la política de datos para recibir avisos por WhatsApp");
  }
  const nombre = p.nombre?.trim() ? p.nombre.trim().slice(0, 60) : null;
  if (telefonoE164) {
    // Un celular = un cliente (índice único parcial): seguro ante emisiones/reservas simultáneas
    const rows = await prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO cliente (telefono_hash, telefono_cifrado, nombre, consentimiento_at)
      VALUES (${hashTelefono(telefonoE164)}, ${cifrar(telefonoE164)}, ${nombre}, now())
      ON CONFLICT (telefono_hash) WHERE telefono_hash IS NOT NULL
      DO UPDATE SET nombre = COALESCE(EXCLUDED.nombre, cliente.nombre),
                    telefono_cifrado = COALESCE(cliente.telefono_cifrado, EXCLUDED.telefono_cifrado),
                    consentimiento_at = now()
      RETURNING id`;
    return rows[0].id;
  }
  if (nombre) return (await prisma.cliente.create({ data: { nombre } })).id;
  return null;
}

export async function emitirTurno(input: EmitirTurnoInput) {
  return medir("turno_emision_ms", () => emitirTurnoInterno(input), { canal: input.canal });
}

async function emitirTurnoInterno(input: EmitirTurnoInput) {
  const cola = await prisma.cola.findUnique({
    where: { id: input.colaId },
    include: { local: { include: { plan: true } } },
  });
  if (!cola || !cola.activa) throw new ErrorNegocio("COLA_INACTIVA", "La cola no existe o está inactiva", 404);
  if (!cola.local.activo) throw new ErrorNegocio("LOCAL_INACTIVO", "El local está inactivo", 403);
  if (!input.omitirHorario) {
    const { localAbierto } = await import("@/lib/operacion");
    const horario = await localAbierto(cola.localId, cola.local.zonaHoraria);
    if (!horario.abierto) throw new ErrorNegocio("COLA_CERRADA", horario.mensaje ?? "El local está cerrado", 409, { proximaApertura: horario.proximaApertura });
  }

  // M1: la categoría se valida ANTES de emitir (C1/C5). Con M1 apagado se ignora (comportamiento original).
  const { resolverCategoria } = await import("@/lib/prioridades/service");
  const origen = input.origenCategoria ?? origenPorCanal(input.canal);
  const categoria = await resolverCategoria(cola.localId, input.categoriaCodigo, origen);

  const emitidoAt = input.emitidoAt ?? new Date();
  const fechaISO = fechaLocalISO(cola.local.zonaHoraria, emitidoAt);

  // RN05: límite mensual del plan
  if (!input.omitirLimitePlan) {
    const inicioMes = fechaADate(`${fechaISO.slice(0, 7)}-01`);
    const turnosMes = await prisma.turno.count({ where: { localId: cola.localId, fecha: { gte: inicioMes }, transferidoDeTurnoId: null } });
    if (turnosMes >= cola.local.plan.maxTurnosMes) {
      throw new ErrorNegocio("LIMITE_PLAN", `El plan ${cola.local.plan.nombre} permite hasta ${cola.local.plan.maxTurnosMes} turnos al mes`, 402);
    }
  }

  // Cliente (dato personal mínimo, cifrado)
  const clienteId = input.clienteId !== undefined ? input.clienteId : await resolverCliente(input);

  // RN03: un cliente solo puede tener 1 turno activo por cola
  if (clienteId) {
    const activo = await prisma.turno.findFirst({
      where: { colaId: cola.id, clienteId, estado: { in: ACTIVOS } },
      select: { codigo: true, token: true },
    });
    if (activo) {
      throw new ErrorNegocio("TURNO_DUPLICADO", `Este celular ya tiene el turno ${activo.codigo} activo en esta cola`, 409, { token: activo.token, codigo: activo.codigo });
    }
  }

  // Emisión transaccional en la BD (función emitir_turno extendida, F5)
  const token = generarToken(10);
  const origenJson = JSON.stringify({
    cita_id: input.citaId ?? null,
    dispositivo_id: input.dispositivoId ?? null,
    codigo_provisional: input.codigoProvisional ?? null,
    transferido_de: input.transferidoDe ?? null,
  });
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM emitir_turno(${cola.id}::int, ${clienteId}::int, ${input.canal}::text, ${token}::text, ${fechaADate(fechaISO)}::date,
                                ${categoria?.id ?? null}::int, ${input.emitidoAt ?? null}::timestamp, ${origenJson}::jsonb)
  `;
  const turnoId = rows[0]?.id;
  if (!turnoId) throw new ErrorNegocio("ERROR_EMISION", "No se pudo emitir el turno", 500);
  if (categoria && origen === "PERSONAL") await prisma.turno.update({ where: { id: turnoId }, data: { prioridadVerificada: true } });
  contar("turnos_emitidos_total", { canal: input.canal });

  // M2: registrar la predicción mostrada (monitoreo continuo, RF-M2-08)
  if (await moduloActivo(cola.localId, "M2")) {
    const { registrarPrediccion } = await import("@/lib/prediccion/service");
    await registrarPrediccion(turnoId).catch((e) => log.warn("no se registró la predicción", { error: String(e), modulo: "M2" }));
  }

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
      local: { select: { id: true, slug: true, nombreComercial: true, colorPrimario: true, logoUrl: true, direccion: true, avisarFaltando: true, zonaHoraria: true } },
      notificaciones: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);

  let posicion = 0;
  let tiempoEstimadoSeg = 0;
  let prediccion: { segundos: number; loSeg: number; hiSeg: number; confianza: number; modelo: string; enfrio: boolean; p50Min: number; p90Min: number } | null = null;
  if (EN_ESPERA.includes(turno.estado)) {
    const rows = await prisma.$queryRaw<{ p: number }[]>`SELECT posicion_turno(${turno.id}::int) AS p`;
    posicion = Number(rows[0]?.p ?? 1);
    if (await moduloActivo(turno.localId, "M2")) {
      const { predecirParaTurno } = await import("@/lib/prediccion/service");
      const p = await predecirParaTurno(turno.colaId, posicion - 1);
      tiempoEstimadoSeg = p.segundos;
      prediccion = { ...p, p50Min: Math.max(1, Math.ceil(p.segundos / 60)), p90Min: Math.max(1, Math.ceil(p.hiSeg / 60)) };
    } else {
      tiempoEstimadoSeg = await tiempoEstimadoBase(turno.colaId, posicion);
    }
  }

  const llamandoAhora = await prisma.turno.findMany({
    where: { colaId: turno.colaId, fecha: turno.fecha, estado: "LLAMADO" },
    orderBy: { llamadoAt: "desc" },
    take: 3,
    select: { codigo: true, codigoProvisional: true, ventanilla: { select: { nombre: true } } },
  });

  // M6: un turno transferido redirige al sucesor (el enlace del cliente sigue funcionando)
  let redirigidoA: { token: string; codigo: string; cola: string } | null = null;
  if (turno.estado === "TRANSFERIDO" && turno.sucesorId) {
    const s = await prisma.turno.findUnique({ where: { id: turno.sucesorId }, select: { token: true, codigo: true, cola: { select: { nombre: true } } } });
    if (s) redirigidoA = { token: s.token, codigo: s.codigo, cola: s.cola.nombre };
  }

  const telefono = turno.cliente?.telefonoCifrado ? descifrar(turno.cliente.telefonoCifrado) : null;
  const { zonaHoraria: _zona, ...localPublico } = turno.local;
  void _zona;

  return {
    id: turno.id,
    codigo: turno.codigo,
    codigoProvisional: turno.codigoProvisional,
    token: turno.token,
    estado: turno.estado,
    canal: turno.canal,
    numero: turno.numero,
    posicion,
    personasDelante: Math.max(0, posicion - 1),
    tiempoEstimadoSeg,
    prediccion,
    avisoMinAntes: turno.avisoMinAntes,
    rellamadas: turno.rellamadas,
    emitidoAt: turno.emitidoAt,
    avisadoAt: turno.avisadoAt,
    llamadoAt: turno.llamadoAt,
    finalizadoAt: turno.finalizadoAt,
    fecha: turno.fecha.toISOString().slice(0, 10),
    cola: turno.cola,
    ventanilla: turno.ventanilla,
    cliente: { nombre: turno.cliente?.nombre ?? null, telefonoMasc: telefono ? enmascararTelefono(telefono) : null },
    local: localPublico,
    redirigidoA,
    llamandoAhora: llamandoAhora.map((t) => ({ codigo: t.codigo, codigoProvisional: t.codigoProvisional, ventanilla: t.ventanilla?.nombre ?? "" })),
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

/** RN02 — función SQL tiempo_estimado(cola, posicion): baseline del núcleo (M2 apagado). */
export async function tiempoEstimadoBase(colaId: number, posicion: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ seg: number }[]>`SELECT tiempo_estimado(${colaId}::int, ${posicion}::int) AS seg`;
  return Number(rows[0]?.seg ?? 0);
}

/** Espera estimada para quien quedaría en `posicion`. Con M2 activo usa el modelo; si no, RN02. */
export async function tiempoEstimado(colaId: number, posicion: number): Promise<number> {
  if (posicion < 1) return 0;
  const cola = await prisma.cola.findUnique({ where: { id: colaId }, select: { localId: true } });
  if (cola && (await moduloActivo(cola.localId, "M2"))) {
    const { predecirParaTurno } = await import("@/lib/prediccion/service");
    return (await predecirParaTurno(colaId, posicion - 1)).segundos;
  }
  return tiempoEstimadoBase(colaId, posicion);
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
  const r = await prisma.turno.updateMany({ where: { id: turno.id, estado: turno.estado }, data: { estado: "CANCELADO", finalizadoAt: new Date() } });
  if (r.count === 0) throw new ErrorNegocio("TRANSICION_INVALIDA", "El turno cambió de estado, vuelve a intentarlo", 409);
  publicar({ tipo: "turno:estado", localId: turno.localId, turno: { id: turno.id, token: turno.token, estado: "CANCELADO" } });
  publicar({ tipo: "cola:actualizada", localId: turno.localId, colaId: turno.colaId });
  void alCerrarTurno(turno.id, "CANCELADO").catch(() => {});
  void revisarAvisos(turno.colaId).catch(() => {});
  return obtenerTurnoPorToken(token);
}

// ---------------------------------------------------------------------------
// Operación de ventanilla (RF05, RF06)
// ---------------------------------------------------------------------------

/**
 * Llama al siguiente turno. La selección ocurre en SQL (`siguiente_turno`, M1/F5) con `FOR UPDATE SKIP LOCKED`,
 * dentro de la misma transacción que lo marca como LLAMADO: dos ventanillas nunca toman el mismo turno (C2).
 */
export async function llamarSiguiente(ventanillaId: number, localId: number, actor?: { usuarioId?: number | null; requestId?: string; ip?: string }) {
  const ventanilla = await prisma.ventanilla.findFirst({ where: { id: ventanillaId, localId }, include: { local: true } });
  if (!ventanilla || !ventanilla.activa) throw new ErrorNegocio("VENTANILLA_INVALIDA", "La ventanilla no existe o está inactiva", 404);

  const fecha = fechaADate(fechaLocalISO(ventanilla.local.zonaHoraria));
  const ahora = new Date();

  const resultado = await medir("llamar_siguiente_ms", () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.usuario_id', ${actor?.usuarioId ? String(actor.usuarioId) : ""}, true), set_config('app.request_id', ${actor?.requestId ?? ""}, true), set_config('app.ip', ${actor?.ip ?? ""}, true)`;
      // El turno que estaba en esta ventanilla pasa a ATENDIDO (cierre implícito)
      const enCurso = await tx.turno.findFirst({ where: { ventanillaId, estado: "LLAMADO" } });
      if (enCurso) {
        await tx.turno.update({
          where: { id: enCurso.id },
          data: { estado: "ATENDIDO", atendidoAt: enCurso.atendidoAt ?? ahora, finalizadoAt: ahora },
        });
      }
      const sel = await tx.$queryRaw<{ id: number | null }[]>`SELECT siguiente_turno(${localId}::int, ${ventanilla.colaId}::int, ${fecha}::date) AS id`;
      const id = sel[0]?.id ?? null;
      let llamado = null;
      if (id) {
        await tx.turno.update({ where: { id }, data: { estado: "LLAMADO", ventanillaId, llamadoAt: ahora } });
        await tx.$executeRaw`UPDATE turno SET avisado_at = COALESCE(avisado_at, ${ahora}) WHERE id = ${id}::int`;
        llamado = await tx.turno.findUnique({ where: { id }, include: { cola: true, cliente: true } });
      }
      return { cerrado: enCurso, llamado };
    }),
  );

  if (resultado.cerrado) {
    publicar({ tipo: "turno:estado", localId, turno: { id: resultado.cerrado.id, token: resultado.cerrado.token, estado: "ATENDIDO" } });
    void alCerrarTurno(resultado.cerrado.id, "ATENDIDO").catch(() => {});
  }
  if (resultado.llamado) {
    const t = resultado.llamado;
    contar("turnos_llamados_total");
    publicar({
      tipo: "turno:llamado",
      localId,
      turno: { id: t.id, codigo: t.codigo, token: t.token, ventanilla: ventanilla.nombre, cola: t.cola.nombre, rellamada: false, codigoProvisional: t.codigoProvisional },
    });
    publicar({ tipo: "turno:estado", localId, turno: { id: t.id, token: t.token, estado: "LLAMADO" } });
    void alLlamarTurno(t.id).catch(() => {});
    void notificarLlamado(t.id, ventanilla.nombre).catch(() => {});
    void revisarAvisos(t.colaId).catch(() => {});
  }
  publicar({ tipo: "cola:actualizada", localId });

  return resultado.llamado ? obtenerTurnoPorToken(resultado.llamado.token) : null;
}

export async function cambiarEstadoTurno(turnoId: number, localId: number, nuevo: EstadoTurno) {
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, localId }, include: { ventanilla: true, cola: true } });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
  if (nuevo === "TRANSFERIDO") throw new ErrorNegocio("TRANSICION_INVALIDA", "Usa la acción Transferir para mover el turno", 409);
  if (!transicionValida(turno.estado, nuevo)) {
    throw new ErrorNegocio("TRANSICION_INVALIDA", `Transición ${turno.estado} → ${nuevo} no permitida`, 409);
  }
  const ahora = new Date();
  const data: Prisma.TurnoUpdateManyMutationInput = { estado: nuevo };
  if (nuevo === "LLAMADO") {
    data.rellamadas = { increment: 1 };
    data.llamadoAt = ahora;
  }
  if (nuevo === "ATENDIDO") {
    data.atendidoAt = turno.atendidoAt ?? ahora;
    data.finalizadoAt = ahora;
  }
  if (nuevo === "NO_SE_PRESENTO" || nuevo === "CANCELADO") data.finalizadoAt = ahora;

  // Guarda optimista: si otro proceso cambió el estado (p. ej. la expiración RN04), no se pisa
  const r = await prisma.turno.updateMany({ where: { id: turno.id, estado: turno.estado }, data });
  if (r.count === 0) throw new ErrorNegocio("TRANSICION_INVALIDA", "El turno cambió de estado, actualiza la pantalla", 409);
  const actualizado = await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } });

  if (nuevo === "LLAMADO") {
    publicar({
      tipo: "turno:llamado",
      localId,
      turno: { id: turno.id, codigo: turno.codigo, token: turno.token, ventanilla: turno.ventanilla?.nombre ?? "", cola: turno.cola.nombre, rellamada: true, codigoProvisional: turno.codigoProvisional },
    });
  }
  publicar({ tipo: "turno:estado", localId, turno: { id: turno.id, token: turno.token, estado: nuevo } });
  publicar({ tipo: "cola:actualizada", localId, colaId: turno.colaId });
  if (nuevo === "ATENDIDO" || nuevo === "NO_SE_PRESENTO" || nuevo === "CANCELADO") void alCerrarTurno(turno.id, nuevo).catch(() => {});
  return actualizado;
}

// ---------------------------------------------------------------------------
// Ganchos de integración entre módulos
// ---------------------------------------------------------------------------

/** Al llamar un turno: M2 completa el valor real de la predicción registrada. */
async function alLlamarTurno(turnoId: number) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, select: { localId: true } });
  if (!t) return;
  if (await moduloActivo(t.localId, "M2")) {
    const { completarReal } = await import("@/lib/prediccion/service");
    await completarReal(turnoId);
  }
}

/** Al cerrar un turno: M3 actualiza la cita (ATENDIDA / NO_SHOW, RN-M3-07) y M2 aprende en línea del servicio. */
export async function alCerrarTurno(turnoId: number, estado: EstadoTurno) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, select: { localId: true, citaId: true } });
  if (!t) return;
  if (t.citaId) {
    const { cerrarCitaPorTurno } = await import("@/lib/citas/service");
    await cerrarCitaPorTurno(t.citaId, estado);
  }
  if (estado === "ATENDIDO" && (await moduloActivo(t.localId, "M2"))) {
    const { aprenderServicio } = await import("@/lib/prediccion/service");
    await aprenderServicio(turnoId);
  }
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
    orderBy: [{ claveOrden: "desc" }, { emitidoAt: "asc" }, { id: "asc" }],
    take: cola.local.avisarFaltando + 1,
    include: { cliente: true },
  });

  for (let i = 0; i < espera.length; i++) {
    const t = espera[i];
    const delante = i; // personas antes que él
    if (delante > cola.local.avisarFaltando) break;
    if (t.estado !== "EMITIDO") continue;

    // Guarda: solo un proceso pasa el turno a AVISADO (evita avisos duplicados)
    const r = await prisma.turno.updateMany({ where: { id: t.id, estado: "EMITIDO" }, data: { estado: "AVISADO", avisadoAt: new Date() } });
    if (r.count === 0) continue;

    const telefono = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
    const url = `${appUrl()}/t/${t.token}`;
    const mensaje = renderTurnoProximo({ nombre: t.cliente?.nombre, codigo: t.codigo, local: cola.local.nombreComercial, faltan: delante, url });
    publicar({ tipo: "turno:estado", localId: cola.localId, turno: { id: t.id, token: t.token, estado: "AVISADO" } });
    void enviarAviso({ localId: cola.localId, turnoId: t.id, telefonoE164: telefono, plantilla: "turno_proximo", parametros: [t.codigo, cola.local.nombreComercial], texto: mensaje }).catch(() => {});
  }
  publicar({ tipo: "cola:actualizada", localId: cola.localId, colaId });
}

async function notificarLlamado(turnoId: number, ventanilla: string) {
  const t = await prisma.turno.findUnique({ where: { id: turnoId }, include: { cliente: true, local: true } });
  if (!t) return;
  const telefono = t.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
  if (!telefono) return;
  const mensaje = renderTurnoLlamado({ codigo: t.codigo, ventanilla, local: t.local.nombreComercial });
  await enviarAviso({ localId: t.localId, turnoId, telefonoE164: telefono, plantilla: "turno_llamado", parametros: [t.codigo, ventanilla], texto: mensaje });
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
    orderBy: [{ claveOrden: "desc" }, { emitidoAt: "asc" }, { id: "asc" }],
    include: {
      cliente: { select: { nombre: true } },
      ventanilla: { select: { id: true, nombre: true } },
      // RN-M1-06: la categoría solo se carga para el personal (panel), nunca para la TV
      categoria: opciones.incluirNombres ? { select: { nombre: true, codigo: true, pesoBase: true, absoluta: true } } : false,
    },
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
        espera: espera.map((t, i) => {
          const cat = opciones.incluirNombres ? (t as typeof t & { categoria?: { nombre: string; codigo: string; pesoBase: number; absoluta: boolean } | null }).categoria : null;
          return {
            id: t.id,
            codigo: t.codigo,
            codigoProvisional: t.codigoProvisional,
            token: t.token,
            estado: t.estado,
            canal: t.canal,
            emitidoAt: t.emitidoAt,
            posicion: i + 1,
            nombre: opciones.incluirNombres ? t.cliente?.nombre ?? null : null,
            categoria: cat?.nombre ?? null,
            categoriaCodigo: cat?.codigo ?? null,
            prioridadVerificada: opciones.incluirNombres ? t.prioridadVerificada : null,
          };
        }),
        llamados: llamados.map((t) => ({
          id: t.id,
          codigo: t.codigo,
          codigoProvisional: t.codigoProvisional,
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
    .filter((t) => t.llamadoAt && t.estado !== "CANCELADO" && t.estado !== "TRANSFERIDO")
    .sort((a, b) => (b.llamadoAt?.getTime() ?? 0) - (a.llamadoAt?.getTime() ?? 0))
    .slice(0, 8)
    .map((t) => ({ id: t.id, codigo: t.codigo, codigoProvisional: t.codigoProvisional, ventanilla: t.ventanilla?.nombre ?? "", estado: t.estado, llamadoAt: t.llamadoAt }));

  const total = turnosHoy.filter((t) => t.estado !== "TRANSFERIDO").length;
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
      tiempoAusenciaSeg: local.tiempoAusenciaSeg,
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
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { zonaHoraria: true } });
  const zona = local?.zonaHoraria ?? "America/Lima";
  const turnos = await prisma.turno.findMany({
    where: { localId, fecha: { gte: desde, lte: hasta }, estado: { not: "TRANSFERIDO" } },
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

  // Por hora (zona horaria del local)
  const porHoraMap = new Map<number, { hora: number; turnos: number; esperaMs: number[] }>();
  for (const t of turnos) {
    const h = horaLocal(t.emitidoAt, zona);
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

/**
 * RNF08 / Ley 29733 — anonimización de datos personales.
 * Clientes sin actividad en `dias` días (turnos y citas), conversaciones del bot y mensajes (30 días),
 * eventos de kiosco con datos (7 días en revisión).
 */
export async function purgarDatosPersonales(dias = 90) {
  const limite = new Date(Date.now() - dias * 24 * 3600 * 1000);
  const r = await prisma.$executeRaw`
    UPDATE cliente c SET telefono_cifrado = NULL, telefono_hash = NULL, nombre = NULL
     WHERE c.created_at < ${limite}
       AND (c.telefono_cifrado IS NOT NULL OR c.nombre IS NOT NULL OR c.telefono_hash IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM turno t WHERE t.cliente_id = c.id AND t.emitido_at >= ${limite})
       AND NOT EXISTS (SELECT 1 FROM cita ci WHERE ci.cliente_id = c.id AND ci.inicio >= ${limite})`;
  const hace30 = new Date(Date.now() - 30 * 86400000);
  const mensajes = await prisma.mensajeBot.deleteMany({ where: { createdAt: { lt: hace30 } } });
  const conversaciones = await prisma.conversacionBot.deleteMany({ where: { ultimoMensajeAt: { lt: hace30 } } });
  const eventosBot = await prisma.eventoBotProcesado.deleteMany({ where: { procesadoAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
  const kiosco = await prisma.$executeRaw`
    UPDATE evento_kiosco SET payload = payload - 'telefonoCifrado' - 'nombre' - 'dni'
     WHERE recibido_at < ${new Date(Date.now() - 7 * 86400000)} AND (payload ? 'telefonoCifrado' OR payload ? 'nombre' OR payload ? 'dni')`;
  return { clientes: Number(r), mensajesBot: mensajes.count, conversaciones: conversaciones.count, eventosBot: eventosBot.count, eventosKiosco: Number(kiosco) };
}
