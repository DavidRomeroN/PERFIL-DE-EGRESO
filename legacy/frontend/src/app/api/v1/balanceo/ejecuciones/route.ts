import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal, q, qNum } from "@backend/rutas";

/** GET /api/v1/balanceo/ejecuciones?regla&resultado&cursor — historial (exportable a CSV desde la UI) */
export const GET = enLocal(ADMIN, "M6", async (req, ctx) => {
  const cursor = q(req, "cursor");
  const filas = await prisma.ejecucionRegla.findMany({
    where: { localId: ctx.localId, ...(qNum(req, "regla") ? { reglaId: qNum(req, "regla")! } : {}), ...(q(req, "resultado") ? { resultado: q(req, "resultado")! } : {}), ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
    orderBy: { id: "desc" },
    take: 50,
    include: { regla: { select: { nombre: true } } },
  });
  return ok({ items: filas.map((f) => ({ ...f, id: String(f.id), regla: f.regla.nombre })), cursor: filas.length === 50 ? String(filas[filas.length - 1].id) : null });
});
