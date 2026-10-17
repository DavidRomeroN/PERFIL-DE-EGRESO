import { ok } from "@backend/api";
import { ADMIN, enLocal, q, qNum } from "@backend/rutas";
import { historialTransferencias } from "@backend/balanceo/service";

export const GET = enLocal(ADMIN, "M6", async (req, ctx) => {
  const d = q(req, "desde");
  const h = q(req, "hasta");
  return ok(await historialTransferencias(ctx.localId, d ? new Date(d) : undefined, h ? new Date(h) : undefined, qNum(req, "cursor") ?? undefined));
});
