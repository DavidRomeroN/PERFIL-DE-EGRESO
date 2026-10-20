import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { publicar } from "@backend/realtime";
import { fechaADate, fechaLocalISO } from "@backend/fechas";
import { moduloActivo } from "@backend/modulos";
import { auditar, type Tx } from "@backend/api";
import type { Session } from "@backend/auth";
import type { DocumentoPrioridad } from "@backend/generated/prisma/client";
import { explicarPuntaje, type ConfigPrioridad } from "@backend/prioridades/reglas";

/** M1 · Casos de uso del motor de prioridades (docs/modulos/M1-prioridades.md). */

export type OrigenCategoria = "CLIENTE" | "PERSONAL" | "CITA";
type Actor = { session?: Session | null; requestId?: string; ip?: string };

export const CATEGORIAS_POR_DEFECTO = [
  { codigo: "GENERAL", nombre: "General", pesoBase: 0, absoluta: false, documento: "NINGUNO", visibleCliente: true, esperaMaxSeg: null, orden: 0 },
  { codigo: "ADULTO_MAYOR", nombre: "Adulto mayor (60+)", pesoBase: 60, absoluta: false, documento: "DNI", visibleCliente: true, esperaMaxSeg: 1800, orden: 1 },
  { codigo: "GESTANTE", nombre: "Gestante", pesoBase: 60, absoluta: false, documento: "CARNE_GESTANTE", visibleCliente: true, esperaMaxSeg: 1800, orden: 2 },
  { codigo: "DISCAPACIDAD", nombre: "Persona con discapacidad", pesoBase: 50, absoluta: false, documento: "CONADIS", visibleCliente: true, esperaMaxSeg: 1800, orden: 3 },
  { codigo: "EMERGENCIA", nombre: "Emergencia", pesoBase: 100, absoluta: true, documento: "TRIAJE", visibleCliente: false, esperaMaxSeg: 0, orden: 4 },
  { codigo: "CITA", nombre: "Cita reservada", pesoBase: 80, absoluta: false, documento: "NINGUNO", visibleCliente: false, esperaMaxSeg: null, orden: 5 },
] as const;

/** Crea las categorías y la configuración por defecto de un local nuevo (idempotente). */
export async function sembrarPrioridades(localId: number, db: Tx | typeof prisma = prisma) {
  for (const c of CATEGORIAS_POR_DEFECTO) {
    await db.categoriaPrioridad.upsert({
      where: { localId_codigo: { localId, codigo: c.codigo } },
      create: { localId, ...c, documento: c.documento as DocumentoPrioridad },
      update: {},
    });
  }
  await db.configPrioridad.upsert({ where: { localId }, create: { localId }, update: {} });
}

export async function leerConfig(localId: number): Promise<ConfigPrioridad> {
  const c = await prisma.configPrioridad.findUnique({ where: { localId } });
  return { alfa: Number(c?.alfaPuntosPorMin ?? 0), tope: c?.topeAdelantos ?? 0, aging: c?.agingActivo ?? false };
}

/**
 * Valida la categoría pedida **antes** de emitir (C1/C5). Devuelve null para GENERAL o si M1 está apagado.
 * El cliente solo puede declarar categorías `visibleCliente`; `CITA` solo la asigna el check-in.
 */
export async function resolverCategoria(localId: number, codigo: string | null | undefined, origen: OrigenCategoria) {
  const cod = codigo?.trim().toUpperCase() || "GENERAL";
  if (!(await moduloActivo(localId, "M1"))) return null;
  const cat = await prisma.categoriaPrioridad.findFirst({ where: { localId, codigo: cod, activa: true } });
  if (!cat && cod === "GENERAL") return null;
  if (!cat) throw new ErrorNegocio("M1_CATEGORIA_INVALIDA", "La categoría no existe", 404);
  if (cod === "CITA" && origen !== "CITA") throw new ErrorNegocio("M1_CATEGORIA_NO_DISPONIBLE", "Categoría reservada para citas", 409);
  if (origen === "CLIENTE" && !cat.visibleCliente) {
    throw new ErrorNegocio("M1_CATEGORIA_NO_DISPONIBLE", "Esa categoría solo la asigna el personal", 409);
  }
  return cat.codigo === "GENERAL" ? null : cat;
}

/** Recalcula en una sola sentencia SQL la clave de los turnos en espera del día (RN-M1-05). */
export async function recalcularClaves(localId: number, zona = "America/Lima") {
  const fecha = fechaADate(fechaLocalISO(zona));
  const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT recalcular_claves(${localId}::int, ${fecha}::date) AS n`;
  publicar({ tipo: "cola:actualizada", localId });
  return Number(rows[0]?.n ?? 0);
}

export async function listarPrioridades(localId: number) {
  const [config, categorias] = await Promise.all([
    leerConfig(localId),
    prisma.categoriaPrioridad.findMany({ where: { localId }, orderBy: [{ orden: "asc" }, { id: "asc" }] }),
  ]);
  return { config, categorias };
}

export async function guardarConfig(actor: Actor, localId: number, cfg: ConfigPrioridad) {
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { zonaHoraria: true } });
  await prisma.configPrioridad.upsert({
    where: { localId },
    create: { localId, alfaPuntosPorMin: cfg.alfa, topeAdelantos: cfg.tope, agingActivo: cfg.aging },
    update: { alfaPuntosPorMin: cfg.alfa, topeAdelantos: cfg.tope, agingActivo: cfg.aging },
  });
  const recalculados = await recalcularClaves(localId, local?.zonaHoraria);
  await auditar(actor, { localId, accion: "PRIORIDAD_CONFIG", entidad: "config_prioridad", entidadId: localId, humana: `Cambió α=${cfg.alfa}, tope=${cfg.tope}, aging=${cfg.aging ? "sí" : "no"}`, datos: { ...cfg, recalculados } });
  return { recalculados };
}

export interface DatosCategoria {
  codigo?: string;
  nombre?: string;
  icono?: string | null;
  pesoBase?: number;
  absoluta?: boolean;
  documento?: DocumentoPrioridad;
  esperaMaxSeg?: number | null;
  visibleCliente?: boolean;
  activa?: boolean;
  orden?: number;
}

async function validarLimiteCategorias(localId: number, excluirId?: number) {
  const local = await prisma.local.findUnique({ where: { id: localId }, include: { plan: true } });
  if (local?.plan.codigo !== "EMPRENDE") return;
  const activas = await prisma.categoriaPrioridad.count({ where: { localId, activa: true, codigo: { notIn: ["GENERAL", "CITA"] }, ...(excluirId ? { id: { not: excluirId } } : {}) } });
  if (activas >= 4) throw new ErrorNegocio("M1_LIMITE_CATEGORIAS", "El plan Emprende permite hasta 4 categorías preferentes activas", 402);
}

export async function crearCategoria(actor: Actor, localId: number, d: DatosCategoria & { codigo: string; nombre: string; pesoBase: number }) {
  if (d.pesoBase < 0 || d.pesoBase > 1000) throw new ErrorNegocio("M1_PESO_FUERA_DE_RANGO", "El peso va de 0 a 1000", 422);
  if (d.activa !== false) await validarLimiteCategorias(localId);
  const cat = await prisma.categoriaPrioridad.create({ data: { localId, ...d, codigo: d.codigo.toUpperCase() } });
  await auditar(actor, { localId, accion: "CATEGORIA_CREAR", entidad: "categoria_prioridad", entidadId: cat.id, humana: `Creó la categoría ${cat.nombre}` });
  return cat;
}

export async function editarCategoria(actor: Actor, localId: number, id: number, d: DatosCategoria) {
  const cat = await prisma.categoriaPrioridad.findFirst({ where: { id, localId } });
  if (!cat) throw new ErrorNegocio("M1_CATEGORIA_INVALIDA", "La categoría no existe", 404);
  if (cat.codigo === "GENERAL" && (d.activa === false || (d.pesoBase !== undefined && d.pesoBase !== 0) || d.absoluta)) {
    throw new ErrorNegocio("M1_NO_ELIMINAR_GENERAL", "La categoría General siempre existe con peso 0", 409);
  }
  if (d.pesoBase !== undefined && (d.pesoBase < 0 || d.pesoBase > 1000)) throw new ErrorNegocio("M1_PESO_FUERA_DE_RANGO", "El peso va de 0 a 1000", 422);
  if (d.activa === true && !cat.activa) await validarLimiteCategorias(localId, id);
  const { codigo: _codigo, ...resto } = d;
  void _codigo;
  const actualizada = await prisma.categoriaPrioridad.update({ where: { id }, data: resto });
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { zonaHoraria: true } });
  if (d.pesoBase !== undefined || d.absoluta !== undefined || d.activa !== undefined) await recalcularClaves(localId, local?.zonaHoraria);
  await auditar(actor, { localId, accion: "CATEGORIA_EDITAR", entidad: "categoria_prioridad", entidadId: id, humana: `Editó la categoría ${actualizada.nombre}`, datos: d });
  return actualizada;
}

/** Borrado lógico (si tiene turnos) o físico (si no). GENERAL no se elimina. */
export async function eliminarCategoria(actor: Actor, localId: number, id: number) {
  const cat = await prisma.categoriaPrioridad.findFirst({ where: { id, localId }, include: { _count: { select: { turnos: true } } } });
  if (!cat) throw new ErrorNegocio("M1_CATEGORIA_INVALIDA", "La categoría no existe", 404);
  if (cat.codigo === "GENERAL") throw new ErrorNegocio("M1_NO_ELIMINAR_GENERAL", "La categoría General no se puede eliminar", 409);
  if (cat._count.turnos > 0) await prisma.categoriaPrioridad.update({ where: { id }, data: { activa: false } });
  else await prisma.categoriaPrioridad.delete({ where: { id } });
  await auditar(actor, { localId, accion: "CATEGORIA_ELIMINAR", entidad: "categoria_prioridad", entidadId: id, humana: `Eliminó la categoría ${cat.nombre}` });
  return { borradoLogico: cat._count.turnos > 0 };
}

/**
 * RF-M1-07: el operador verifica, rechaza (pasa a General conservando la antigüedad, RN-M1-04) o cambia la categoría.
 */
export async function cambiarPrioridadTurno(actor: Actor, localId: number, turnoId: number, accion: "VERIFICAR" | "RECHAZAR" | "CAMBIAR", categoriaCodigo?: string | null) {
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, localId }, include: { categoria: true, local: { select: { zonaHoraria: true } } } });
  if (!turno) throw new ErrorNegocio("TURNO_NO_ENCONTRADO", "El turno no existe", 404);
  if (!["EMITIDO", "AVISADO"].includes(turno.estado)) throw new ErrorNegocio("TRANSICION_INVALIDA", "Solo se cambia la prioridad de un turno en espera", 409);

  if (accion === "VERIFICAR") {
    await prisma.turno.update({ where: { id: turno.id }, data: { prioridadVerificada: true } });
    await auditar(actor, { localId, accion: "PRIORIDAD_VERIFICAR", entidad: "turno", entidadId: turno.id, humana: `Verificó la prioridad de ${turno.codigo}` });
  } else {
    let nuevaId: number | null = null;
    if (accion === "CAMBIAR") {
      const cat = await resolverCategoria(localId, categoriaCodigo, "PERSONAL");
      nuevaId = cat?.id ?? null;
    }
    await prisma.$executeRaw`
      UPDATE turno SET categoria_id = ${nuevaId}::int,
             prioridad_verificada = ${accion === "RECHAZAR" ? false : true},
             clave_orden = calcular_clave_orden(peso_categoria(${nuevaId}::int), emitido_at AT TIME ZONE 'UTC',
                 COALESCE((SELECT alfa_puntos_por_min FROM config_prioridad WHERE local_id = ${localId}::int), 0),
                 COALESCE((SELECT aging_activo FROM config_prioridad WHERE local_id = ${localId}::int), false))
       WHERE id = ${turno.id}::int`;
    await auditar(actor, {
      localId,
      accion: accion === "RECHAZAR" ? "PRIORIDAD_RECHAZAR" : "PRIORIDAD_CAMBIAR",
      entidad: "turno",
      entidadId: turno.id,
      humana: accion === "RECHAZAR" ? `Rechazó la prioridad de ${turno.codigo} (pasa a General)` : `Cambió la categoría de ${turno.codigo} a ${categoriaCodigo ?? "GENERAL"}`,
      datos: { antes: turno.categoria?.codigo ?? "GENERAL", despues: accion === "RECHAZAR" ? "GENERAL" : (categoriaCodigo ?? "GENERAL") },
    });
  }
  publicar({ tipo: "cola:actualizada", localId, colaId: turno.colaId });
  return prisma.turno.findUnique({ where: { id: turno.id }, include: { categoria: true } });
}

/** Explicación del puntaje del siguiente turno para el panel del operador (RF-M1-06). */
export async function explicacionSiguiente(localId: number, colaId: number | null, zona: string) {
  if (!(await moduloActivo(localId, "M1"))) return null;
  const fecha = fechaADate(fechaLocalISO(zona));
  const cfg = await leerConfig(localId);
  const sig = await prisma.turno.findFirst({
    where: { localId, fecha, estado: { in: ["EMITIDO", "AVISADO"] }, ...(colaId ? { colaId } : {}) },
    orderBy: [{ claveOrden: "desc" }, { emitidoAt: "asc" }, { id: "asc" }],
    include: { categoria: true },
  });
  if (!sig) return null;
  const e = explicarPuntaje({ id: sig.id, emitidoMs: sig.emitidoAt.getTime(), categoria: sig.categoria }, cfg, Date.now());
  return { turnoId: sig.id, codigo: sig.codigo, categoria: sig.categoria?.nombre ?? "General", ...e };
}

/** Anti-abuso (§11): rechazos de prioridad del mismo celular en 30 días. */
export async function rechazosPrevios(clienteId: number | null) {
  if (!clienteId) return 0;
  const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { telefonoHash: true } });
  if (!cliente?.telefonoHash) return 0;
  return prisma.turno.count({
    where: { prioridadVerificada: false, emitidoAt: { gte: new Date(Date.now() - 30 * 86400000) }, cliente: { telefonoHash: cliente.telefonoHash } },
  });
}
