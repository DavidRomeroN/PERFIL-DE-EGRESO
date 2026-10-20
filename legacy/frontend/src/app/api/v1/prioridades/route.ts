import { ok } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { listarPrioridades } from "@backend/prioridades/service";

/** GET /api/v1/prioridades — configuración y categorías (M1) */
export const GET = enLocal(ADMIN, "M1", async (_req, ctx) => ok(await listarPrioridades(ctx.localId)));
