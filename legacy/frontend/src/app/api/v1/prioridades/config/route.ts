import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { guardarConfig } from "@backend/prioridades/service";

const schema = z.object({
  alfaPuntosPorMin: z.number().min(0).max(10),
  topeAdelantos: z.number().int().min(0).max(10),
  agingActivo: z.boolean(),
});

/** PUT /api/v1/prioridades/config — α, tope y aging; recalcula las claves en espera (RN-M1-05) */
export const PUT = enLocal(ADMIN, "M1", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await guardarConfig(ctx, ctx.localId, { alfa: b.alfaPuntosPorMin, tope: b.topeAdelantos, aging: b.agingActivo }));
});
