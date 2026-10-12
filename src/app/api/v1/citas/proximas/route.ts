import { ok } from "@/lib/api";
import { STAFF, enLocal } from "@/lib/rutas";
import { proximas } from "@/lib/citas/service";

/** GET /api/v1/citas/proximas — citas de los próximos 60 min (bloque del panel) */
export const GET = enLocal(STAFF, "M3", async (_req, ctx) => ok(await proximas(ctx.localId)));
