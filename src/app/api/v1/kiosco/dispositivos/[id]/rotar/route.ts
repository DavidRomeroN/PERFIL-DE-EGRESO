import { auditar, ok, paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { rotar } from "@/lib/kiosco/service";

/** POST /api/v1/kiosco/dispositivos/:id/rotar — invalida el token y genera un código nuevo */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M5", async (_req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const r = await rotar(ctx.localId, id);
  await auditar(ctx, { localId: ctx.localId, accion: "KIOSCO_ROTAR", entidad: "dispositivo_kiosco", entidadId: id, humana: "Rotó el token de un kiosco" });
  return ok(r);
});
