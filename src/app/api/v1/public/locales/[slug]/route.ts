import { prisma } from "@/lib/db";
import { error, ok, paramsDe, publico } from "@/lib/api";
import { tiempoEstimado } from "@/lib/turnos";
import { fechaADate, fechaLocalISO } from "@/lib/fechas";
import { modulosActivos } from "@/lib/modulos";
import { localAbierto } from "@/lib/operacion";

/** GET /api/v1/public/locales/:slug — información pública del local, sus colas y los módulos visibles al cliente */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await paramsDe(ctx);
  const local = await prisma.local.findUnique({
    where: { slug },
    include: {
      plan: { select: { codigo: true, nombre: true, whatsappHabilitado: true } },
      colas: { where: { activa: true }, orderBy: { orden: "asc" }, include: { configCitas: { select: { activo: true } } } },
    },
  });
  if (!local || !local.activo) return error("LOCAL_NO_ENCONTRADO", "El local no existe", 404);

  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria));
  const activos = await modulosActivos(local.id);
  const colas = await Promise.all(
    local.colas.map(async (c) => {
      const enEspera = await prisma.turno.count({ where: { colaId: c.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] } } });
      return {
        id: c.id,
        prefijo: c.prefijo,
        nombre: c.nombre,
        descripcion: c.descripcion,
        enEspera,
        tiempoEstimadoSeg: await tiempoEstimado(c.id, enEspera + 1),
        conCita: activos.has("M3") && !!c.configCitas?.activo,
      };
    }),
  );
  const horario = await localAbierto(local.id, local.zonaHoraria);

  return ok({
    id: local.id,
    slug: local.slug,
    nombreComercial: local.nombreComercial,
    rubro: local.rubro,
    direccion: local.direccion,
    colorPrimario: local.colorPrimario,
    logoUrl: local.logoUrl,
    mensajeBienvenida: local.mensajeBienvenida,
    avisarFaltando: local.avisarFaltando,
    plan: local.plan,
    abierto: horario.abierto,
    mensajeCerrado: horario.mensaje,
    proximaApertura: horario.proximaApertura,
    modulos: { prioridades: activos.has("M1"), prediccion: activos.has("M2"), citas: activos.has("M3") },
    colas,
    // RN-M1-06: al cliente solo se le ofrecen las categorías que puede autodeclarar
    categorias: activos.has("M1")
      ? await prisma.categoriaPrioridad.findMany({
          where: { localId: local.id, activa: true, visibleCliente: true, codigo: { not: "GENERAL" } },
          select: { codigo: true, nombre: true, icono: true, documento: true },
          orderBy: { orden: "asc" },
        })
      : [],
  });
});
