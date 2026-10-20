import { ok } from "@backend/api";
import { STAFF, enLocal } from "@backend/rutas";
import { pinActual } from "@backend/citas/service";

/** GET /api/v1/citas/pin — PIN de presencia vigente para el panel del operador (M3) */
export const GET = enLocal(STAFF, "M3", async (_req, ctx) => ok(pinActual(ctx.localId)));
