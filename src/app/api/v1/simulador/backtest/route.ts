import { error, ok } from "@/lib/api";
import { ADMIN, enLocal, qNum } from "@/lib/rutas";
import { datosBacktest } from "@/lib/capacidad/service";

export const GET = enLocal(ADMIN, "M8", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await datosBacktest(ctx.localId, colaId, Math.min(30, qNum(req, "dias") ?? 14)));
});
