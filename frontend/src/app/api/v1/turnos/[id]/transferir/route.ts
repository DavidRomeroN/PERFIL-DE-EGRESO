import { z } from "zod";
import { ok, paramsDe, parseBody } from "@backend/api";
import { STAFF, enLocal } from "@backend/rutas";
import { MOTIVOS, transferir } from "@backend/balanceo/service";

const schema = z.object({
  aColaId: z.number().int().positive(),
  aVentanillaId: z.number().int().positive().nullable().optional(),
  motivo: z.enum(MOTIVOS),
  detalle: z.string().trim().max(200).nullable().optional(),
  notificar: z.boolean().optional().default(true),
});

/** POST /api/v1/turnos/:id/transferir — conserva hora de emisión y categoría (RF-M6-01/02) */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(STAFF, "M6", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await transferir(ctx, ctx.localId, Number((await paramsDe(ctx)).id), b), { status: 201 });
});
