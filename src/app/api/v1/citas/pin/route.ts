import { ok } from "@/lib/api";
import { STAFF, enLocal } from "@/lib/rutas";
import { pinActual } from "@/lib/citas/service";

/** GET /api/v1/citas/pin — PIN de presencia vigente para el panel del operador (M3) */
export const GET = enLocal(STAFF, "M3", async (_req, ctx) => ok(pinActual(ctx.localId)));
