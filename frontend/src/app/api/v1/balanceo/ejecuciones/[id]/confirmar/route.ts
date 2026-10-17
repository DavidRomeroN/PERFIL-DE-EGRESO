import { z } from "zod";
import { ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { resolverConfirmacion } from "@backend/balanceo/service";

const schema = z.object({ aprobar: z.boolean() });

/** POST /api/v1/balanceo/ejecuciones/:id/confirmar — aprueba o rechaza una acción pendiente */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M6", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await resolverConfirmacion(ctx, ctx.localId, BigInt((await paramsDe(ctx)).id), b.aprobar));
});
