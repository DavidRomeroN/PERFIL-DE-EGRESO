import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { reentrenarLocal } from "@backend/prediccion/service";

const schema = z.object({ colaId: z.number().int().positive().optional().nullable() });

/** POST /api/v1/prediccion/reentrenar — entrena ahora y responde MAE antes → después */
export const POST = enLocal(ADMIN, "M2", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await reentrenarLocal(ctx.localId, b.colaId));
});
