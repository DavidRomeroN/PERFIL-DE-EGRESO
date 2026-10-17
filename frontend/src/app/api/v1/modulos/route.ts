import { ok } from "@backend/api";
import { STAFF, enLocal } from "@backend/rutas";
import { estadoModulos } from "@backend/modulos";

/** GET /api/v1/modulos — módulos del local: incluidos en el plan y encendidos (F3, para UI y hub) */
export const GET = enLocal(STAFF, null, async (_req, ctx) => ok(await estadoModulos(ctx.localId)));
