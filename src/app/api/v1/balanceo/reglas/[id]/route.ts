import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { editarRegla, eliminarRegla } from "@/lib/balanceo/service";
import { accionSchema, condicionSchema } from "@/lib/balanceo/reglas";

const schema = z.object({
  nombre: z.string().trim().min(3).max(80),
  condicion: condicionSchema,
  accion: accionSchema,
  forSegundos: z.number().int().min(0).max(3600).optional(),
  forSegundosReversa: z.number().int().min(0).max(3600).optional(),
  cooldownSeg: z.number().int().min(120).max(86400).optional(),
  histeresisPct: z.number().int().min(0).max(80).optional(),
  ttlSeg: z.number().int().min(60).max(86400).nullable().optional(),
  requiereConfirmacion: z.boolean().optional(),
  prioridad: z.number().int().min(1).max(1000).optional(),
}).partial().extend({ activa: z.boolean().optional(), modo: z.enum(["SIMULACION", "ACTIVA"]).optional() });
type P = { params: Promise<{ id: string }> };

/** PATCH /api/v1/balanceo/reglas/:id — editar, activar (modo ACTIVA, auditado) o desactivar */
export const PATCH = enLocal<P>(ADMIN, "M6", async (req, ctx) => ok(await editarRegla(ctx, ctx.localId, Number((await paramsDe(ctx)).id), await parseBody(req, schema))));

export const DELETE = enLocal<P>(ADMIN, "M6", async (_req, ctx) => {
  await eliminarRegla(ctx, ctx.localId, Number((await paramsDe(ctx)).id));
  return ok({ eliminada: true });
});
