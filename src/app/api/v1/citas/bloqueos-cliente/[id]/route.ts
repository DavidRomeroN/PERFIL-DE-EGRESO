import { ok, paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { liberarCliente } from "@/lib/citas/service";

/** DELETE /api/v1/citas/bloqueos-cliente/:id — el admin libera a un cliente bloqueado por inasistencias */
export const DELETE = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M3", async (_req, ctx) => {
  await liberarCliente(ctx.localId, Number((await paramsDe(ctx)).id), ctx.session.sub);
  return ok({ liberado: true });
});
