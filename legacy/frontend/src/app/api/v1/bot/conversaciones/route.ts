import { ok } from "@backend/api";
import { ADMIN, enLocal, q } from "@backend/rutas";
import { bandeja } from "@backend/bot/service";

/** GET /api/v1/bot/conversaciones?handoff=true&cursor — bandeja del local (teléfonos enmascarados) */
export const GET = enLocal(ADMIN, "M4", async (req, ctx) => {
  const h = q(req, "handoff");
  return ok(await bandeja(ctx.localId, { handoff: h === null ? undefined : h === "true", cursor: q(req, "cursor") }));
});
