import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { validarRegla } from "@/lib/balanceo/service";
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
}).extend({ id: z.number().int().optional() });

/** POST /api/v1/balanceo/reglas/validar — sin guardar: condición, recursos y contradicciones */
export const POST = enLocal(ADMIN, "M6", async (req, ctx) => {
  const { id, ...b } = await parseBody(req, schema);
  return ok({ valida: true, ...(await validarRegla(ctx.localId, b, id)) });
});
