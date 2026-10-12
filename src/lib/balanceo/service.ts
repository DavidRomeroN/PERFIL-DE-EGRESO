import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { publicar } from "@/lib/realtime";
import { descifrar, generarToken } from "@/lib/crypto";
import { exigirModulo, moduloActivo } from "@/lib/modulos";
import { enviarAviso } from "@/lib/notificaciones";
import { contar, observar } from "@/lib/metricas";
import { fechaADate, fechaLocalISO } from "@/lib/fechas";
import { auditar, type Tx } from "@/lib/api";
import type { Session } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";
import {
  MAX_ACCIONES_HORA,
  accionSchema,
  avanzar,
  condicionImposible,
  condicionSalida,
  condicionSchema,
  describirAccion,
  esReversible,
  evaluar,
  reglasContradictorias,
  type Accion,
  type Condicion,
  type EstadoRegla,
  type MetricasLocal,
} from "@/lib/balanceo/reglas";

/** M6 · Transferencia de turnos y balanceo automático (docs/modulos/M6-transferencia-balanceo.md). */

type Actor = { session?: Session | null; requestId?: string; ip?: string };
export const MOTIVOS = ["OTRO_SERVICIO", "FALTA_DOCUMENTO", "DERIVACION", "ERROR_DE_COLA", "BALANCEO"] as const;
export type Motivo = (typeof MOTIVOS)[number];

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// §6.1 Transferencia en una transacción (conserva emitido_at y categoría ⇒ conserva el lugar)
// ---------------------------------------------------------------------------
export async function transferir(
  actor: Actor,
  localId: number,
  turnoId: number,
  p: { aColaId: number; aVentanillaId?: number | null; motivo: Motivo; detalle?: string | null; notificar?: boolean; origen?: "MANUAL" | "REGLA"; reglaId?: number | null },
) {
  const t0 = performance.now();
  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${actor.session?.sub ? String(actor.session.sub) : ""}, true), set_config('app.request_id', ${actor.requestId ?? ""}, true)`;
    const filas = await tx.$queryRaw<{ id: number; estado: string; cola_id: number; cliente_id: number | null; canal: string; categoria_id: number | null; emitido_at: Date; codigo: string; token: string; ventanilla_id: number | null }[]>`
      SELECT id, estado::text, cola_id, cliente_id, canal::text, categoria_id, emitido_at, codigo, token, ventanilla_id
        FROM turno WHERE id = ${turnoId}::int AND local_id = ${localId}::int FOR UPDATE`;
    const t = filas[0];
    if (!t) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
    if (!["EMITIDO", "AVISADO", "LLAMADO"].includes(t.estado)) throw new ErrorNegocio("M6_ESTADO_NO_TRANSFERIBLE", `Un turno ${t.estado} no se puede transferir`, 409);
    const destino = await tx.cola.findFirst({ where: { id: p.aColaId, localId, activa: true }, include: { local: true } });
    if (!destino || destino.id === t.cola_id) throw new ErrorNegocio("M6_COLA_DESTINO_INVALIDA", "Elige otra cola activa del local", 404);
    if (p.aVentanillaId) {
      const v = await tx.ventanilla.findFirst({ where: { id: p.aVentanillaId, localId, activa: true } });
      if (!v) throw new ErrorNegocio("M6_COLA_DESTINO_INVALIDA", "La ventanilla destino no existe", 404);
    }
    if (t.cliente_id) {
      const ya = await tx.turno.findFirst({ where: { colaId: destino.id, clienteId: t.cliente_id, estado: { in: ["EMITIDO", "AVISADO", "LLAMADO"] } } });
      if (ya) throw new ErrorNegocio("M6_CLIENTE_YA_EN_DESTINO", "El cliente ya tiene un turno en esa cola", 409);
    }
    const token = generarToken(10);
    const fecha = fechaADate(fechaLocalISO(destino.local.zonaHoraria));
    const origen = JSON.stringify({ transferido_de: t.id });
    // RN-M6-02: el sucesor hereda emitido_at y categoría; su clave se calcula con el α vigente
    const nuevo = await tx.$queryRaw<{ id: number; codigo: string; token: string }[]>`
      SELECT id, codigo, token FROM emitir_turno(${destino.id}::int, ${t.cliente_id}::int, ${t.canal}::text, ${token}::text, ${fecha}::date,
                                                 ${t.categoria_id}::int, ${t.emitido_at}::timestamp, ${origen}::jsonb)`;
    const s = nuevo[0];
    await tx.turno.update({ where: { id: t.id }, data: { estado: "TRANSFERIDO", finalizadoAt: new Date(), sucesorId: s.id, ventanillaId: t.estado === "LLAMADO" ? null : undefined } });
    await tx.transferencia.create({
      data: { localId, turnoOrigenId: t.id, turnoDestinoId: s.id, deColaId: t.cola_id, aColaId: destino.id, aVentanillaId: p.aVentanillaId ?? null, motivo: p.motivo, detalle: p.detalle ?? null, origen: p.origen ?? "MANUAL", reglaId: p.reglaId ?? null, usuarioId: actor.session?.sub ?? null },
    });
    await auditar(actor, { localId, accion: "TRANSFERIR_TURNO", entidad: "turno", entidadId: t.id, humana: `Transfirió ${t.codigo} a ${destino.nombre} (${s.codigo})`, datos: { sucesorId: s.id, motivo: p.motivo } }, tx as Tx);
    return { original: t, sucesor: s, destino };
  });
  observar("m6_transferencia_ms", performance.now() - t0);
  contar("m6_transferencias_total", { motivo: p.motivo });
  publicar({ tipo: "turno:estado", localId, turno: { id: res.original.id, token: res.original.token, estado: "TRANSFERIDO" } });
  publicar({ tipo: "cola:actualizada", localId, colaId: res.original.cola_id });
  publicar({ tipo: "cola:actualizada", localId, colaId: res.destino.id });

  if (p.notificar !== false) {
    const t = await prisma.turno.findUnique({ where: { id: res.sucesor.id }, include: { cliente: true } });
    const tel = t?.cliente?.telefonoCifrado ? descifrar(t.cliente.telefonoCifrado) : null;
    void enviarAviso({
      localId,
      turnoId: res.sucesor.id,
      telefonoE164: tel,
      plantilla: "turno_transferido",
      texto: `🔁 Te derivamos a *${res.destino.nombre}*. Tu nuevo turno es *${res.sucesor.codigo}* y conservas tu lugar. Sigue aquí: ${appUrl()}/t/${res.sucesor.token}`,
    }).catch(() => {});
  }
  const { obtenerTurnoPorToken, revisarAvisos } = await import("@/lib/turnos");
  void revisarAvisos(res.destino.id).catch(() => {});
  return obtenerTurnoPorToken(res.sucesor.token);
}

export async function historialTransferencias(localId: number, desde?: Date, hasta?: Date, cursor?: number) {
  const filas = await prisma.transferencia.findMany({
    where: { localId, ...(desde || hasta ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { id: "desc" },
    take: 50,
  });
  return { items: filas, cursor: filas.length === 50 ? filas[filas.length - 1].id : null };
}

// ---------------------------------------------------------------------------
// §6.2 Métricas del local en una sola consulta
// ---------------------------------------------------------------------------
export async function calcularMetricas(localId: number, ahora = new Date()): Promise<MetricasLocal & { detalle: { colaId: number; cola: string; [k: string]: number | string }[] }> {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId }, select: { zonaHoraria: true } });
  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria, ahora));
  const hace15 = new Date(ahora.getTime() - 15 * 60000);
  const rows = await prisma.$queryRaw<{ cola_id: number; nombre: string; en_espera: number; espera_max_min: number | null; espera_prom_min: number | null; operativas: number; ocupadas: number; llegadas: number }[]>`
    WITH t AS (SELECT * FROM turno WHERE local_id = ${localId}::int AND fecha = ${fecha}::date)
    SELECT c.id AS cola_id, c.nombre,
           (SELECT COUNT(*) FROM t WHERE t.cola_id = c.id AND t.estado IN ('EMITIDO','AVISADO'))::int AS en_espera,
           (SELECT EXTRACT(EPOCH FROM (${ahora}::timestamp - MIN(t.emitido_at))) / 60 FROM t WHERE t.cola_id = c.id AND t.estado IN ('EMITIDO','AVISADO')) AS espera_max_min,
           (SELECT AVG(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at))) / 60 FROM t WHERE t.cola_id = c.id AND t.llamado_at >= ${hace15}) AS espera_prom_min,
           (SELECT COUNT(DISTINCT t.ventanilla_id) FROM t WHERE t.cola_id = c.id AND t.ventanilla_id IS NOT NULL AND (t.estado = 'LLAMADO' OR t.llamado_at >= ${hace15}))::int AS operativas,
           (SELECT COUNT(DISTINCT t.ventanilla_id) FROM t WHERE t.cola_id = c.id AND t.estado = 'LLAMADO')::int AS ocupadas,
           (SELECT COUNT(*) FROM t WHERE t.cola_id = c.id AND t.emitido_at >= ${hace15})::int AS llegadas
      FROM cola c WHERE c.local_id = ${localId}::int AND c.activa`;
  const { estadoSla } = await import("@/lib/analitica/consultas");
  const sla = (await moduloActivo(localId, "M7")) ? await estadoSla(localId, ahora) : [];
  const colas: MetricasLocal["colas"] = {};
  const detalle: { colaId: number; cola: string; [k: string]: number | string }[] = [];
  for (const r of rows) {
    const operativas = Math.max(r.operativas, 0);
    const libres = Math.max(0, operativas - r.ocupadas);
    const s = sla.find((x) => x.colaId === r.cola_id);
    const m = {
      en_espera: r.en_espera,
      espera_max_min: Math.round((r.espera_max_min ?? 0) * 10) / 10,
      espera_prom_min: Math.round((r.espera_prom_min ?? 0) * 10) / 10,
      ventanillas_operativas: operativas,
      ventanillas_libres: libres,
      utilizacion: operativas ? Math.round((1 - libres / operativas) * 100) / 100 : 0,
      tasa_llegada_15m: r.llegadas,
      ...(s && s.configurado && s.cumplimientoPct !== null ? { sla_cumplimiento: s.cumplimientoPct } : {}),
    };
    colas[r.cola_id] = m;
    detalle.push({ colaId: r.cola_id, cola: r.nombre, ...m });
  }
  const proms = rows.map((r) => r.espera_prom_min ?? 0).filter((x) => x > 0);
  return { colas, local: { espera_prom_local: proms.length ? Math.round((proms.reduce((a, b) => a + b, 0) / proms.length) * 10) / 10 : 0 }, detalle };
}

/** GET /balanceo/carga — por cola y por ventanilla. */
export async function carga(localId: number) {
  const m = await calcularMetricas(localId);
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId } });
  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria));
  const vents = await prisma.ventanilla.findMany({ where: { localId }, include: { cola: { select: { nombre: true } } }, orderBy: { id: "asc" } });
  const ventanillas = await Promise.all(
    vents.map(async (v) => {
      const atendidos = await prisma.turno.count({ where: { ventanillaId: v.id, fecha, estado: "ATENDIDO" } });
      const actual = await prisma.turno.findFirst({ where: { ventanillaId: v.id, estado: "LLAMADO" }, select: { codigo: true } });
      return { id: v.id, nombre: v.nombre, activa: v.activa, cola: v.cola?.nombre ?? "Todas", atendidosHoy: atendidos, atendiendo: actual?.codigo ?? null, temporal: !!v.colaOriginalId };
    }),
  );
  return { colas: m.detalle, ventanillas, local: m.local };
}

// ---------------------------------------------------------------------------
// Reglas: CRUD y validación
// ---------------------------------------------------------------------------
export interface DatosRegla {
  nombre: string;
  condicion: Condicion;
  accion: Accion;
  forSegundos?: number;
  forSegundosReversa?: number;
  cooldownSeg?: number;
  histeresisPct?: number;
  ttlSeg?: number | null;
  requiereConfirmacion?: boolean;
  prioridad?: number;
}

async function validarRecursos(localId: number, d: DatosRegla) {
  const colas = new Set((await prisma.cola.findMany({ where: { localId }, select: { id: true } })).map((c) => c.id));
  const vents = new Set((await prisma.ventanilla.findMany({ where: { localId }, select: { id: true } })).map((v) => v.id));
  const idsCond: number[] = [];
  const recorrer = (c: Condicion) => {
    if ("all" in c) c.all.forEach(recorrer);
    else if ("any" in c) c.any.forEach(recorrer);
    else if ("not" in c) recorrer(c.not);
    else if (c.scope?.cola) idsCond.push(c.scope.cola);
  };
  recorrer(d.condicion);
  const a = d.accion;
  const colasAccion = a.tipo === "MOVER_OPERADOR" ? [a.desdeColaId, a.haciaColaId] : a.tipo === "DERIVAR_TURNOS" ? [a.deColaId, a.aColaId] : a.tipo === "ABRIR_VENTANILLA" && a.colaId ? [a.colaId] : [];
  if ([...idsCond, ...colasAccion].some((id) => !colas.has(id))) throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La regla usa colas de otro local", 422);
  if ((a.tipo === "ABRIR_VENTANILLA" || (a.tipo === "MOVER_OPERADOR" && a.ventanillaId)) && !vents.has((a as { ventanillaId: number }).ventanillaId)) {
    throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La ventanilla no es de este local", 422);
  }
}

export async function validarRegla(localId: number, d: DatosRegla, id?: number) {
  const cond = condicionSchema.safeParse(d.condicion);
  if (!cond.success) throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La condición no es válida", 422);
  const acc = accionSchema.safeParse(d.accion);
  if (!acc.success) throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La acción no es válida", 422);
  if (condicionImposible(d.condicion)) throw new ErrorNegocio("M6_CONDICION_IMPOSIBLE", "La condición nunca puede cumplirse", 422);
  await validarRecursos(localId, d);
  const otras = await prisma.reglaBalanceo.findMany({ where: { localId, activa: true } });
  const choque = reglasContradictorias(
    { id: id ?? -1, accion: d.accion, forSegundos: d.forSegundos ?? 300, cooldownSeg: d.cooldownSeg ?? 600, activa: true },
    otras.map((o) => ({ id: o.id, accion: o.accion as unknown as Accion, forSegundos: o.forSegundos, cooldownSeg: o.cooldownSeg, activa: o.activa })),
  );
  if (choque) throw new ErrorNegocio("M6_REGLAS_CONTRADICTORIAS", `Contradice a la regla #${choque}: moverían el mismo operador en sentidos opuestos`, 409, { reglaId: choque });
  return { avisos: (d.histeresisPct ?? 20) < 5 ? ["Histéresis menor a 5 %: la regla puede oscilar"] : [] };
}

export async function crearRegla(actor: Actor, localId: number, d: DatosRegla) {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId }, include: { plan: true } });
  if (local.plan.codigo !== "PRO") throw new ErrorNegocio("M6_LIMITE_REGLAS", "Las reglas automáticas son del plan Pro (en Emprende hay transferencia manual)", 402);
  if ((await prisma.reglaBalanceo.count({ where: { localId } })) >= 20) throw new ErrorNegocio("M6_LIMITE_REGLAS", "Máximo 20 reglas por local", 402);
  await validarRegla(localId, d);
  // RN-M6-09: toda regla nace en SIMULACION
  const r = await prisma.reglaBalanceo.create({
    data: { localId, nombre: d.nombre, activa: true, modo: "SIMULACION", condicion: d.condicion as Prisma.InputJsonValue, accion: d.accion as Prisma.InputJsonValue, forSegundos: d.forSegundos ?? 300, forSegundosReversa: d.forSegundosReversa ?? 300, cooldownSeg: Math.max(120, d.cooldownSeg ?? 600), histeresisPct: d.histeresisPct ?? 20, ttlSeg: d.ttlSeg ?? null, requiereConfirmacion: d.requiereConfirmacion ?? false, prioridad: d.prioridad ?? 100, createdBy: actor.session?.sub ?? null },
  });
  await auditar(actor, { localId, accion: "REGLA_CREAR", entidad: "regla_balanceo", entidadId: r.id, humana: `Creó la regla "${r.nombre}" (simulación)` });
  return r;
}

export async function editarRegla(actor: Actor, localId: number, id: number, d: Partial<DatosRegla> & { activa?: boolean; modo?: "SIMULACION" | "ACTIVA" }) {
  const r = await prisma.reglaBalanceo.findFirst({ where: { id, localId } });
  if (!r) throw new ErrorNegocio("NO_ENCONTRADO", "La regla no existe", 404);
  if (d.modo === "ACTIVA" && actor.session?.rol !== "ADMIN_LOCAL" && actor.session?.rol !== "SUPER_ADMIN") throw new ErrorNegocio("PROHIBIDO", "Solo un administrador activa reglas", 403);
  const fusion: DatosRegla = {
    nombre: d.nombre ?? r.nombre,
    condicion: (d.condicion ?? r.condicion) as Condicion,
    accion: (d.accion ?? r.accion) as Accion,
    forSegundos: d.forSegundos ?? r.forSegundos,
    cooldownSeg: d.cooldownSeg ?? r.cooldownSeg,
    histeresisPct: d.histeresisPct ?? r.histeresisPct,
  };
  if (d.activa !== false) await validarRegla(localId, fusion, id);
  const act = await prisma.reglaBalanceo.update({
    where: { id },
    data: {
      ...(d.nombre ? { nombre: d.nombre } : {}),
      ...(d.condicion ? { condicion: d.condicion as Prisma.InputJsonValue } : {}),
      ...(d.accion ? { accion: d.accion as Prisma.InputJsonValue } : {}),
      ...(d.forSegundos !== undefined ? { forSegundos: d.forSegundos } : {}),
      ...(d.forSegundosReversa !== undefined ? { forSegundosReversa: d.forSegundosReversa } : {}),
      ...(d.cooldownSeg !== undefined ? { cooldownSeg: Math.max(120, d.cooldownSeg) } : {}),
      ...(d.histeresisPct !== undefined ? { histeresisPct: d.histeresisPct } : {}),
      ...(d.ttlSeg !== undefined ? { ttlSeg: d.ttlSeg } : {}),
      ...(d.requiereConfirmacion !== undefined ? { requiereConfirmacion: d.requiereConfirmacion } : {}),
      ...(d.prioridad !== undefined ? { prioridad: d.prioridad } : {}),
      ...(d.activa !== undefined ? { activa: d.activa } : {}),
      ...(d.modo ? { modo: d.modo } : {}),
    },
  });
  if (d.activa === false) await prisma.reglaEstado.deleteMany({ where: { reglaId: id } });
  await auditar(actor, { localId, accion: d.modo === "ACTIVA" ? "REGLA_ACTIVAR" : "REGLA_EDITAR", entidad: "regla_balanceo", entidadId: id, humana: d.modo === "ACTIVA" ? `Activó la regla "${act.nombre}"` : `Editó la regla "${act.nombre}"` });
  return act;
}

export async function eliminarRegla(actor: Actor, localId: number, id: number) {
  const r = await prisma.reglaBalanceo.findFirst({ where: { id, localId }, include: { estado: true } });
  if (!r) throw new ErrorNegocio("NO_ENCONTRADO", "La regla no existe", 404);
  if (r.estado?.fase === "ACTIVA") await revertir(localId, r.id, r.accion as unknown as Accion, r.estado.estadoAccion);
  await prisma.reglaBalanceo.delete({ where: { id } });
  await auditar(actor, { localId, accion: "REGLA_ELIMINAR", entidad: "regla_balanceo", entidadId: id, humana: `Eliminó la regla "${r.nombre}"` });
}

/** POST /balanceo/reglas/:id/probar — qué haría con las métricas actuales. */
export async function probarRegla(localId: number, id: number) {
  const r = await prisma.reglaBalanceo.findFirst({ where: { id, localId } });
  if (!r) throw new ErrorNegocio("NO_ENCONTRADO", "La regla no existe", 404);
  const m = await calcularMetricas(localId);
  const nombres = Object.fromEntries(m.detalle.map((d) => [d.colaId, d.cola]));
  const cumple = evaluar(r.condicion as Condicion, m);
  return { cumpleAhora: cumple, haria: cumple ? `Habría decidido ${describirAccion(r.accion as Accion, nombres)} (tras ${r.forSegundos} s sostenidos)` : "No haría nada con la carga actual", metricas: m.detalle };
}

// ---------------------------------------------------------------------------
// Ejecutor y reversión
// ---------------------------------------------------------------------------
async function ejecutar(localId: number, reglaId: number, a: Accion): Promise<{ estadoAccion: Record<string, unknown> | null; detalle: string }> {
  switch (a.tipo) {
    case "ABRIR_VENTANILLA": {
      const v = await prisma.ventanilla.findFirstOrThrow({ where: { id: a.ventanillaId, localId } });
      await prisma.ventanilla.update({ where: { id: v.id }, data: { activa: true, ...(a.colaId ? { colaId: a.colaId, colaOriginalId: v.colaId } : {}), reglaAsignadoraId: reglaId } });
      return { estadoAccion: { ventanillaId: v.id, estabaActiva: v.activa, colaAnterior: v.colaId }, detalle: `Abrió ${v.nombre}` };
    }
    case "MOVER_OPERADOR": {
      // Exclusión mutua por recurso (RN-M6-08): no se toca una ventanilla ya movida por otra regla
      const v = await prisma.ventanilla.findFirst({
        where: { localId, activa: true, colaId: a.desdeColaId, reglaAsignadoraId: null, ...(a.ventanillaId ? { id: a.ventanillaId } : {}), turnos: { none: { estado: "LLAMADO" } } },
        orderBy: { id: "desc" },
      });
      if (!v) throw new ErrorNegocio("M6_SIN_RECURSO", "No hay una ventanilla libre en la cola de origen", 409);
      await prisma.ventanilla.update({ where: { id: v.id }, data: { colaId: a.haciaColaId, colaOriginalId: a.desdeColaId, reglaAsignadoraId: reglaId } });
      return { estadoAccion: { ventanillaId: v.id, colaOriginal: a.desdeColaId }, detalle: `Movió ${v.nombre} a la cola ${a.haciaColaId}` };
    }
    case "DERIVAR_TURNOS": {
      const ts = await prisma.turno.findMany({ where: { localId, colaId: a.deColaId, estado: { in: ["EMITIDO", "AVISADO"] } }, orderBy: [{ claveOrden: "asc" }, { emitidoAt: "desc" }], take: a.cantidad });
      let n = 0;
      for (const t of ts) {
        try {
          await transferir({}, localId, t.id, { aColaId: a.aColaId, motivo: "BALANCEO", origen: "REGLA", reglaId });
          n++;
        } catch {
          /* turno ya llamado o cliente en destino: se omite */
        }
      }
      return { estadoAccion: null, detalle: `Derivó ${n} turnos` };
    }
    case "NOTIFICAR": {
      const { alertaDeSistema } = await import("@/lib/analitica/alertas");
      await alertaDeSistema(localId, "COLA_LARGA", `regla:${reglaId}`, a.mensaje, { reglaId });
      return { estadoAccion: null, detalle: "Notificó al admin" };
    }
    case "AJUSTAR_ALFA": {
      const cfg = await prisma.configPrioridad.findUnique({ where: { localId } });
      const antes = Number(cfg?.alfaPuntosPorMin ?? 1.5);
      const despues = Math.min(10, Math.max(0, antes + a.delta));
      await prisma.configPrioridad.upsert({ where: { localId }, create: { localId, alfaPuntosPorMin: despues }, update: { alfaPuntosPorMin: despues } });
      const { recalcularClaves } = await import("@/lib/prioridades/service");
      await recalcularClaves(localId);
      return { estadoAccion: { alfaAntes: antes }, detalle: `α ${antes} → ${despues}` };
    }
  }
}

async function revertir(localId: number, reglaId: number, a: Accion, estadoAccion: unknown) {
  const ea = (estadoAccion ?? {}) as Record<string, number | boolean | null>;
  if (a.tipo === "MOVER_OPERADOR" && ea.ventanillaId) {
    await prisma.ventanilla.updateMany({ where: { id: Number(ea.ventanillaId), localId, reglaAsignadoraId: reglaId }, data: { colaId: Number(ea.colaOriginal), colaOriginalId: null, reglaAsignadoraId: null } });
  } else if (a.tipo === "ABRIR_VENTANILLA" && ea.ventanillaId) {
    await prisma.ventanilla.updateMany({ where: { id: Number(ea.ventanillaId), localId, reglaAsignadoraId: reglaId }, data: { activa: !!ea.estabaActiva, colaId: (ea.colaAnterior as number | null) ?? undefined, colaOriginalId: null, reglaAsignadoraId: null } });
  } else if (a.tipo === "AJUSTAR_ALFA" && typeof ea.alfaAntes === "number") {
    await prisma.configPrioridad.update({ where: { localId }, data: { alfaPuntosPorMin: ea.alfaAntes } });
    const { recalcularClaves } = await import("@/lib/prioridades/service");
    await recalcularClaves(localId);
  }
  contar("m6_reversiones_total");
}

async function registrar(reglaId: number, localId: number, fase: string, metricas: unknown, resultado: string, detalle?: unknown) {
  const e = await prisma.ejecucionRegla.create({ data: { reglaId, localId, fase, metricas: metricas as Prisma.InputJsonValue, resultado, detalle: (detalle ?? undefined) as Prisma.InputJsonValue | undefined } });
  contar("m6_disparos_total", { resultado });
  publicar({ tipo: "balanceo:accion", localId, reglaId, resultado });
  return e;
}

/** Un ciclo del evaluador para un local (§6.4). Llamar con el candado consultivo tomado. */
export async function evaluarLocal(localId: number, ahora = new Date()) {
  const t0 = performance.now();
  const reglas = await prisma.reglaBalanceo.findMany({ where: { localId, activa: true }, include: { estado: true }, orderBy: [{ prioridad: "asc" }, { id: "asc" }] });
  if (!reglas.length) return { reglas: 0 };
  const m = await calcularMetricas(localId, ahora);
  const nombres = Object.fromEntries(m.detalle.map((d) => [d.colaId, d.cola]));
  const resumen = m.detalle;
  for (const r of reglas) {
    const accion = r.accion as unknown as Accion;
    const cond = evaluar(r.condicion as Condicion, m);
    const salida = evaluar(condicionSalida(r.condicion as Condicion, r.histeresisPct), m);
    const previo: EstadoRegla = {
      fase: (r.estado?.fase as EstadoRegla["fase"]) ?? "INACTIVA",
      verdaderaDesdeMs: r.estado?.verdaderaDesde?.getTime() ?? null,
      falsaDesdeMs: r.estado?.falsaDesde?.getTime() ?? null,
      ultimaEjecucionMs: r.estado?.ultimaEjecucionAt?.getTime() ?? null,
      ejecutadaMs: (r.estado?.estadoAccion as { ejecutadaMs?: number } | null)?.ejecutadaMs ?? null,
    };
    const reversible = esReversible(accion) && r.modo === "ACTIVA" && !r.requiereConfirmacion;
    const { estado, decision } = avanzar(previo, cond, salida, ahora.getTime(), { forSegundos: r.forSegundos, forSegundosReversa: r.forSegundosReversa, cooldownSeg: r.cooldownSeg, ttlSeg: r.ttlSeg, reversible });
    let estadoAccion: unknown = r.estado?.estadoAccion ?? null;
    let fase = estado.fase;

    if (decision === "OMITIDA_COOLDOWN") await registrar(r.id, localId, "DISPARO", resumen, "OMITIDA_COOLDOWN");
    if (decision === "EJECUTAR") {
      const ultimaHora = await prisma.ejecucionRegla.count({ where: { localId, resultado: "EJECUTADA", ts: { gte: new Date(ahora.getTime() - 3600_000) } } });
      if (r.modo === "SIMULACION") {
        await registrar(r.id, localId, "SIMULACION", resumen, "SIMULADA", { habria: `Habría decidido ${describirAccion(accion, nombres)}` });
        fase = "INACTIVA";
      } else if (ultimaHora >= MAX_ACCIONES_HORA) {
        await registrar(r.id, localId, "DISPARO", resumen, "OMITIDA_LIMITE");
        contar("m6_limite_total");
        const { alertaDeSistema } = await import("@/lib/analitica/alertas");
        await alertaDeSistema(localId, "BALANCEO_LIMITE", "balanceo", "Límite de acciones automáticas por hora alcanzado", { reglaId: r.id }).catch(() => {});
        fase = "INACTIVA";
      } else if (r.requiereConfirmacion) {
        await registrar(r.id, localId, "CONFIRMACION", resumen, "PENDIENTE_CONFIRMACION", { haria: describirAccion(accion, nombres) });
        fase = "INACTIVA";
      } else {
        try {
          const res = await ejecutar(localId, r.id, accion);
          estadoAccion = res.estadoAccion ? { ...res.estadoAccion, ejecutadaMs: ahora.getTime() } : null;
          await registrar(r.id, localId, "DISPARO", resumen, "EJECUTADA", { detalle: res.detalle });
          if (!res.estadoAccion) fase = "INACTIVA";
        } catch (e) {
          await registrar(r.id, localId, "DISPARO", resumen, "FALLIDA", { error: e instanceof Error ? e.message : String(e) });
          fase = "INACTIVA";
        }
      }
    }
    if (decision === "REVERTIR") {
      await revertir(localId, r.id, accion, estadoAccion);
      await registrar(r.id, localId, "REVERSION", resumen, "EJECUTADA", { detalle: "Acción revertida" });
      estadoAccion = null;
    }
    await prisma.reglaEstado.upsert({
      where: { reglaId: r.id },
      create: { reglaId: r.id, fase, verdaderaDesde: estado.verdaderaDesdeMs ? new Date(estado.verdaderaDesdeMs) : null, falsaDesde: estado.falsaDesdeMs ? new Date(estado.falsaDesdeMs) : null, ultimaEjecucionAt: estado.ultimaEjecucionMs ? new Date(estado.ultimaEjecucionMs) : null, estadoAccion: (estadoAccion ?? undefined) as Prisma.InputJsonValue | undefined },
      update: { fase, verdaderaDesde: estado.verdaderaDesdeMs ? new Date(estado.verdaderaDesdeMs) : null, falsaDesde: estado.falsaDesdeMs ? new Date(estado.falsaDesdeMs) : null, ultimaEjecucionAt: estado.ultimaEjecucionMs ? new Date(estado.ultimaEjecucionMs) : null, estadoAccion: (estadoAccion ?? null) as Prisma.InputJsonValue },
    });
  }
  observar("m6_eval_ms", performance.now() - t0);
  contar("m6_reglas_evaluadas_total", undefined, reglas.length);
  return { reglas: reglas.length };
}

/**
 * Job cada 30 s (D5): solo locales con M6 activo **y** reglas definidas; un candado consultivo por local evita
 * que dos instancias evalúen a la vez (RNF-M6-02). Ya no se mueve nada "a ciegas" en todos los locales.
 */
export async function jobBalanceo(ahora = new Date()) {
  const locales = await prisma.reglaBalanceo.findMany({ where: { activa: true }, distinct: ["localId"], select: { localId: true } });
  let evaluados = 0;
  for (const { localId } of locales) {
    if (!(await moduloActivo(localId, "M6"))) continue;
    await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`balanceo:${localId}`})) AS ok`;
      if (!lock[0]?.ok) return;
      await evaluarLocal(localId, ahora);
      evaluados++;
    }, { timeout: 60_000 });
  }
  return { evaluados };
}

export async function resolverConfirmacion(actor: Actor, localId: number, ejecucionId: bigint, aprobar: boolean) {
  const e = await prisma.ejecucionRegla.findFirst({ where: { id: ejecucionId, localId }, include: { regla: true } });
  if (!e || e.resultado !== "PENDIENTE_CONFIRMACION") throw new ErrorNegocio("M6_EJECUCION_NO_PENDIENTE", "La solicitud ya no está pendiente", 409);
  if (!aprobar) {
    await prisma.ejecucionRegla.update({ where: { id: e.id }, data: { resultado: "RECHAZADA", confirmadaPor: actor.session?.sub ?? null } });
    return { ejecutada: false };
  }
  const res = await ejecutar(localId, e.reglaId, e.regla.accion as unknown as Accion);
  await prisma.ejecucionRegla.update({ where: { id: e.id }, data: { resultado: "EJECUTADA", confirmadaPor: actor.session?.sub ?? null, detalle: { detalle: res.detalle } } });
  if (res.estadoAccion) {
    await prisma.reglaEstado.upsert({
      where: { reglaId: e.reglaId },
      create: { reglaId: e.reglaId, fase: "ACTIVA", ultimaEjecucionAt: new Date(), estadoAccion: { ...res.estadoAccion, ejecutadaMs: Date.now() } as Prisma.InputJsonValue },
      update: { fase: "ACTIVA", ultimaEjecucionAt: new Date(), estadoAccion: { ...res.estadoAccion, ejecutadaMs: Date.now() } as Prisma.InputJsonValue },
    });
  }
  await auditar(actor, { localId, accion: "REGLA_CONFIRMAR", entidad: "ejecucion_regla", entidadId: String(e.id), humana: `Aprobó la acción de "${e.regla.nombre}": ${res.detalle}` });
  return { ejecutada: true, detalle: res.detalle };
}

/** Botón manual "Balancear ahora" (sugerencia simple, auditada). */
export async function balancearAhora(actor: Actor, localId: number) {
  await exigirModulo(localId, "M6");
  const { sugerirMovimiento } = await import("@/lib/balanceo/reglas");
  const colas = await prisma.cola.findMany({
    where: { localId, activa: true },
    include: { _count: { select: { turnos: { where: { estado: { in: ["EMITIDO", "AVISADO"] }, fecha: fechaADate(fechaLocalISO()) } } } }, ventanillas: { where: { activa: true } } },
  });
  const mov = sugerirMovimiento(colas.map((c) => ({ colaId: c.id, enEspera: c._count.turnos, ventanillas: c.ventanillas.length })));
  if (!mov) return { movido: false as const };
  const v = await prisma.ventanilla.findFirst({ where: { localId, colaId: mov.desde, activa: true, turnos: { none: { estado: "LLAMADO" } } } });
  if (!v) return { movido: false as const };
  await prisma.ventanilla.update({ where: { id: v.id }, data: { colaId: mov.hacia } });
  await auditar(actor, { localId, accion: "BALANCEO", entidad: "ventanilla", entidadId: v.id, humana: `Movió ${v.nombre} a otra cola`, datos: mov });
  publicar({ tipo: "cola:actualizada", localId });
  return { movido: true as const, ...mov, ventanilla: v.nombre };
}
