import { error, ok } from "@backend/api";
import { ADMIN, enLocal, qNum } from "@backend/rutas";
import { datosBacktest } from "@backend/capacidad/service";

export const GET = enLocal(ADMIN, "M8", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await datosBacktest(ctx.localId, colaId, Math.min(30, qNum(req, "dias") ?? 14)));
});
