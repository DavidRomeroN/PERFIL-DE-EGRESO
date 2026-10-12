import { ok } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { listarPrioridades } from "@/lib/prioridades/service";

/** GET /api/v1/prioridades — configuración y categorías (M1) */
export const GET = enLocal(ADMIN, "M1", async (_req, ctx) => ok(await listarPrioridades(ctx.localId)));
