import { ok } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { estadoSla } from "@backend/analitica/consultas";

/** GET /api/v1/analitica/sla — cumplimiento actual con censura a la derecha y presupuesto de error */
export const GET = enLocal(ADMIN, "M7", async (_req, ctx) => ok(await estadoSla(ctx.localId)));
