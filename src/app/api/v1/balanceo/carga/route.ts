import { ok } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { carga } from "@/lib/balanceo/service";

/** GET /api/v1/balanceo/carga — mapa de carga por cola y ventanilla */
export const GET = enLocal(ADMIN, "M6", async (_req, ctx) => ok(await carga(ctx.localId)));
