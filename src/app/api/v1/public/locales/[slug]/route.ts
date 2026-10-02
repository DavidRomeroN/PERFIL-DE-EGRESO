import { prisma } from "@/lib/db";
import { error, ok, paramsDe, publico } from "@/lib/api";
import { tiempoEstimado } from "@/lib/turnos";

/** GET /api/v1/public/locales/:slug — información pública del local y sus colas */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await paramsDe(ctx);
  const local = await prisma.local.findUnique({
    where: { slug },
    include: {
      plan: { select: { codigo: true, nombre: true, whatsappHabilitado: true } },
      colas: { where: { activa: true }, orderBy: { orden: "asc" } },
    },
  });
  if (!local || !local.activo) return error("LOCAL_NO_ENCONTRADO", "El local no existe", 404);

  const colas = await Promise.all(
    local.colas.map(async (c) => {
      const enEspera = await prisma.turno.count({ where: { colaId: c.id, estado: { in: ["EMITIDO", "AVISADO"] } } });
      return {
        id: c.id,
        prefijo: c.prefijo,
        nombre: c.nombre,
        descripcion: c.descripcion,
        enEspera,
        tiempoEstimadoSeg: await tiempoEstimado(c.id, enEspera + 1),
      };
    }),
  );

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
    colas,
  });
});
