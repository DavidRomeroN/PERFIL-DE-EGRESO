import { error, ok } from "@/lib/api";
import { ADMIN, enLocal, qNum } from "@/lib/rutas";
import { serieSla } from "@/lib/analitica/consultas";

export const GET = enLocal(ADMIN, "M7", async (req, ctx) => {
  const colaId = qNum(req, "colaId");
  if (!colaId) return error("VALIDACION", "Indica la cola", 422);
  return ok(await serieSla(ctx.localId, colaId, Math.min(30, qNum(req, "dias") ?? 7)));
});
