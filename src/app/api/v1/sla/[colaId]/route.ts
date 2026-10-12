import { z } from "zod";
import { error, ok, paramsDe, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";

const schema = z.object({ esperaMaxMin: z.number().int().min(1).max(480), objetivoPct: z.number().min(1).max(100), ventanaMin: z.number().int().min(15).max(1440).default(60), activo: z.boolean().default(true) });
type P = { params: Promise<{ colaId: string }> };

async function cola(localId: number, id: number) {
  return prisma.cola.findFirst({ where: { id, localId }, include: { sla: true } });
}

export const GET = enLocal<P>(ADMIN, "M7", async (_req, ctx) => {
  const c = await cola(ctx.localId, Number((await paramsDe(ctx)).colaId));
  if (!c) return error("COLA_INACTIVA", "La cola no existe", 404);
  return ok(c.sla);
});

/** PUT /api/v1/sla/:colaId — auditado por trigger (RN-M7-09) */
export const PUT = enLocal<P>(ADMIN, "M7", async (req, ctx) => {
  const id = Number((await paramsDe(ctx)).colaId);
  if (!(await cola(ctx.localId, id))) return error("COLA_INACTIVA", "La cola no existe", 404);
  const b = await parseBody(req, schema);
  return ok(await prisma.slaCola.upsert({ where: { colaId: id }, create: { colaId: id, ...b }, update: b }));
});
