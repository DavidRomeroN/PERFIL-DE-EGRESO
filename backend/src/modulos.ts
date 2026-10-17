import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import type { ModuloCodigo } from "@backend/generated/prisma/client";

/**
 * F3 · Banderas de módulo (ADR-03).
 * Un módulo está activo en un local si su plan lo incluye (`plan_modulo`) **y** el admin del local
 * lo encendió (`local_modulo.habilitado`). Con el módulo apagado el sistema se comporta como el núcleo original.
 */

export const MODULOS: { codigo: ModuloCodigo; nombre: string; descripcion: string; ruta: string; integrante: string }[] = [
  { codigo: "M1", nombre: "Prioridades", descripcion: "Atención preferente con antigüedad (aging) y tope de adelantos", ruta: "/admin/modulos/prioridades", integrante: "Nick Mayta" },
  { codigo: "M2", nombre: "Predicción de espera", descripcion: "Rango de espera p50–p90 y mejores horas para venir", ruta: "/admin/modulos/prediccion", integrante: "Nick Mayta" },
  { codigo: "M3", nombre: "Citas y reservas", descripcion: "Reserva de horarios con check-in por QR y PIN", ruta: "/admin/modulos/citas", integrante: "Jhan Ramos" },
  { codigo: "M4", nombre: "Chatbot de WhatsApp", descripcion: "Tomar, consultar y cancelar turnos conversando", ruta: "/admin/bandeja", integrante: "Jhan Ramos" },
  { codigo: "M5", nombre: "Kiosco offline", descripcion: "Autoservicio táctil que emite aunque se caiga internet", ruta: "/admin/modulos/kiosco", integrante: "David Romero" },
  { codigo: "M6", nombre: "Transferencia y balanceo", descripcion: "Mover turnos entre colas y reglas automáticas de ventanillas", ruta: "/admin/modulos/balanceo", integrante: "David Romero" },
  { codigo: "M7", nombre: "Analítica y SLA", descripcion: "Percentiles, mapa de calor, alertas y reportes programados", ruta: "/admin/analitica", integrante: "Henyelrey Garcia" },
  { codigo: "M8", nombre: "Simulador de capacidad", descripcion: "Erlang C y simulación de eventos discretos", ruta: "/admin/simulador", integrante: "Henyelrey Garcia" },
];

const TTL_MS = 30_000;
const globalCache = globalThis as unknown as { turnoyaModulos?: Map<number, { at: number; activos: Set<ModuloCodigo> }> };
const cache = globalCache.turnoyaModulos ?? new Map<number, { at: number; activos: Set<ModuloCodigo> }>();
globalCache.turnoyaModulos = cache;

/** Conjunto de módulos activos del local (caché de 30 s). */
export async function modulosActivos(localId: number): Promise<Set<ModuloCodigo>> {
  const hit = cache.get(localId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.activos;
  const local = await prisma.local.findUnique({
    where: { id: localId },
    select: { plan: { select: { modulos: { select: { modulo: true } } } }, modulos: { where: { habilitado: true }, select: { modulo: true } } },
  });
  const incluidos = new Set(local?.plan.modulos.map((m) => m.modulo) ?? []);
  const activos = new Set((local?.modulos ?? []).map((m) => m.modulo).filter((m) => incluidos.has(m)));
  cache.set(localId, { at: Date.now(), activos });
  return activos;
}

export async function moduloActivo(localId: number, codigo: ModuloCodigo) {
  return (await modulosActivos(localId)).has(codigo);
}

/** Lanza 403 `MODULO_NO_DISPONIBLE` si el módulo no está activo en el local. */
export async function exigirModulo(localId: number, codigo: ModuloCodigo) {
  if (!(await moduloActivo(localId, codigo))) {
    const nombre = MODULOS.find((m) => m.codigo === codigo)?.nombre ?? codigo;
    throw new ErrorNegocio("MODULO_NO_DISPONIBLE", `El módulo ${nombre} no está activo en este local`, 403);
  }
}

export function invalidarModulos(localId?: number) {
  if (localId === undefined) cache.clear();
  else cache.delete(localId);
}

/** Estado de cada módulo para el hub: incluido en el plan y encendido en el local. */
export async function estadoModulos(localId: number) {
  const local = await prisma.local.findUnique({
    where: { id: localId },
    select: { plan: { select: { nombre: true, modulos: { select: { modulo: true } } } }, modulos: true },
  });
  const incluidos = new Set(local?.plan.modulos.map((m) => m.modulo) ?? []);
  return MODULOS.map((m) => {
    const fila = local?.modulos.find((x) => x.modulo === m.codigo);
    return { ...m, incluido: incluidos.has(m.codigo), habilitado: incluidos.has(m.codigo) && !!fila?.habilitado, plan: local?.plan.nombre ?? "" };
  });
}

export async function cambiarModulo(localId: number, codigo: ModuloCodigo, habilitado: boolean) {
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { plan: { select: { modulos: true, nombre: true } } } });
  if (!local) throw new ErrorNegocio("LOCAL_NO_ENCONTRADO", "El local no existe", 404);
  if (habilitado && !local.plan.modulos.some((m) => m.modulo === codigo)) {
    throw new ErrorNegocio("MODULO_NO_INCLUIDO", `El plan ${local.plan.nombre} no incluye este módulo`, 402);
  }
  await prisma.localModulo.upsert({
    where: { localId_modulo: { localId, modulo: codigo } },
    create: { localId, modulo: codigo, habilitado },
    update: { habilitado },
  });
  invalidarModulos(localId);
}
