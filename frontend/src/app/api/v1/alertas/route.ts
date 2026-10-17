import { ok } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal, q } from "@backend/rutas";
import { serializarAlerta } from "@backend/analitica/alertas";

/** GET /api/v1/alertas?estado=ABIERTA,RECONOCIDA&tipo&cursor */
export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const estados = q(req, "estado")?.split(",").filter(Boolean);
  const cursor = q(req, "cursor");
  const filas = await prisma.alerta.findMany({
    where: { localId: ctx.localId, ...(estados?.length ? { estado: { in: estados as never[] } } : {}), ...(q(req, "tipo") ? { tipo: q(req, "tipo") as never } : {}), ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
    orderBy: { id: "desc" },
    take: 50,
  });
  return ok({ items: filas.map(serializarAlerta), cursor: filas.length === 50 ? String(filas[filas.length - 1].id) : null });
});
