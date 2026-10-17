import { ok, paramsDe } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { probarRegla } from "@backend/balanceo/service";

/** POST /api/v1/balanceo/reglas/:id/probar — qué haría con la carga actual */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M6", async (_req, ctx) => ok(await probarRegla(ctx.localId, Number((await paramsDe(ctx)).id))));
