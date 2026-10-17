import { ok } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { carga } from "@backend/balanceo/service";

/** GET /api/v1/balanceo/carga — mapa de carga por cola y ventanilla */
export const GET = enLocal(ADMIN, "M6", async (_req, ctx) => ok(await carga(ctx.localId)));
