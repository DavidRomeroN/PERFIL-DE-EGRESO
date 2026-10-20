import { ok } from "@backend/api";
import { STAFF, enLocal } from "@backend/rutas";
import { proximas } from "@backend/citas/service";

/** GET /api/v1/citas/proximas — citas de los próximos 60 min (bloque del panel) */
export const GET = enLocal(STAFF, "M3", async (_req, ctx) => ok(await proximas(ctx.localId)));
