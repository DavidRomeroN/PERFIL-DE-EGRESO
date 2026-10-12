import { ok, paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { eliminarBloqueoAgenda } from "@/lib/citas/service";

export const DELETE = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M3", async (_req, ctx) => {
  await eliminarBloqueoAgenda(ctx.localId, Number((await paramsDe(ctx)).id));
  return ok({ eliminado: true });
});
