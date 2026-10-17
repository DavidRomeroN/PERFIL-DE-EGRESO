import { z } from "zod";
import { auditar, error, ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal, qNum } from "@backend/rutas";
import { configCola, guardarConfig } from "@backend/citas/service";

const schema = z.object({
  colaId: z.number().int().positive(),
  activo: z.boolean(),
  duracionSlotMin: z.number().int().min(5).max(240),
  cuotaCitasPct: z.number().int().min(1).max(100),
  capacidadFija: z.number().int().min(1).max(50).nullable().optional(),
  anticipacionMinMin: z.number().int().min(0).max(10080),
  anticipacionMaxDias: z.number().int().min(1).max(60),
  checkinAntesMin: z.number().int().min(0).max(120),
  checkinDespuesMin: z.number().int().min(0).max(120),
  graciaNoShowMin: z.number().int().min(0).max(120),
  maxNoShow: z.number().int().min(0).max(20),
  bloqueoDias: z.number().int().min(0).max(365),
  pesoCita: z.number().int().min(0).max(1000),
});

/** GET /api/v1/citas/config?colaId — sin colaId devuelve todas las colas del local */
export const GET = enLocal(ADMIN, "M3", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  const colas = await prisma.cola.findMany({ where: { localId: ctx.localId, ...(colaId ? { id: colaId } : {}) }, orderBy: { orden: "asc" } });
  if (colaId && !colas.length) return error("COLA_INACTIVA", "La cola no existe", 404);
  return ok(await Promise.all(colas.map(async (c) => ({ cola: { id: c.id, nombre: c.nombre }, config: await configCola(c.id) }))));
});

export const PUT = enLocal(ADMIN, "M3", async (req, ctx) => {
  const { colaId, ...datos } = await parseBody(req, schema);
  const r = await guardarConfig(ctx.localId, colaId, datos);
  await auditar(ctx, { localId: ctx.localId, accion: "CITAS_CONFIG", entidad: "config_citas", entidadId: colaId, humana: `Configuró las citas de la cola ${colaId}`, datos });
  return ok(r);
});
