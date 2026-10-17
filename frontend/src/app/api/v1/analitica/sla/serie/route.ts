import { error, ok } from "@backend/api";
import { ADMIN, enLocal, qNum } from "@backend/rutas";
import { serieSla } from "@backend/analitica/consultas";

export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await serieSla(ctx.localId, colaId, Math.min(30, qNum(req, "dias") ?? 7)));
});
