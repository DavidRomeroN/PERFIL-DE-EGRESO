import { error, ok } from "@/lib/api";
import { ADMIN, enLocal, q, qNum } from "@/lib/rutas";
import { calibracion } from "@/lib/capacidad/service";

/** GET /api/v1/simulador/calibracion?colaId&dias=28&tipoDia=laborable|sabado|todos */
export const GET = enLocal(ADMIN, "M8", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  const t = q(req, "tipoDia") ?? "laborable";
  return ok(await calibracion(ctx.localId, colaId, Math.min(90, qNum(req, "dias") ?? 28), (["laborable", "sabado", "todos"].includes(t) ? t : "laborable") as "laborable"));
});
