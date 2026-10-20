import { error, ok } from "@backend/api";
import { ADMIN, enLocal, qNum } from "@backend/rutas";
import { metricasPrediccion } from "@backend/prediccion/service";

/** GET /api/v1/prediccion/metricas?colaId&dias=14 (M2) */
export const GET = enLocal(ADMIN, "M2", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await metricasPrediccion(ctx.localId, colaId, Math.min(60, qNum(req, "dias") ?? 14)));
});
