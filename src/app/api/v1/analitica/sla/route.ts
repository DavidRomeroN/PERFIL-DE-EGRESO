import { ok } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { estadoSla } from "@/lib/analitica/consultas";

/** GET /api/v1/analitica/sla — cumplimiento actual con censura a la derecha y presupuesto de error */
export const GET = enLocal(ADMIN, "M7", async (_req, ctx) => ok(await estadoSla(ctx.localId)));
