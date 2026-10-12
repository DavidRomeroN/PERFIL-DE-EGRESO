import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal, qNum } from "@/lib/rutas";

export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const filas = await prisma.reporteGenerado.findMany({
    where: { programado: { localId: ctx.localId }, ...(qNum(req, "programadoId") ? { programadoId: qNum(req, "programadoId")! } : {}) },
    orderBy: { id: "desc" },
    take: 50,
    include: { programado: { select: { nombre: true } } },
  });
  return ok(filas.map((f) => ({ ...f, id: String(f.id), programado: f.programado.nombre })));
});
