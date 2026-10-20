import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal, qNum } from "@backend/rutas";

export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const filas = await prisma.reporteGenerado.findMany({
    where: { programado: { localId: ctx.localId }, ...(qNum(req, "programadoId") ? { programadoId: qNum(req, "programadoId")! } : {}) },
    orderBy: { id: "desc" },
    take: 50,
    include: { programado: { select: { nombre: true } } },
  });
  return ok(filas.map((f) => ({ ...f, id: String(f.id), programado: f.programado.nombre })));
});
