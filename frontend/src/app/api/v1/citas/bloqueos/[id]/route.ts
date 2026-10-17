import { ok, paramsDe } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { eliminarBloqueoAgenda } from "@backend/citas/service";

export const DELETE = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M3", async (_req, ctx) => {
  await eliminarBloqueoAgenda(ctx.localId, Number((await paramsDe(ctx)).id));
  return ok({ eliminado: true });
});
