import { ok } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { balancearAhora } from "@backend/balanceo/service";

/** POST /api/v1/balanceo — "Balancear ahora" manual (auditado). El automático usa reglas. */
export const POST = enLocal(ADMIN, "M6", async (_req, ctx) => ok(await balancearAhora(ctx, ctx.localId)));
