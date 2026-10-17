import { z } from "zod";
import { auditar, ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { resolverEvento } from "@backend/kiosco/service";

const schema = z.object({ accion: z.enum(["EMITIR_AHORA", "DESCARTAR"]) });

/** POST /api/v1/kiosco/eventos/:id/resolver — conflicto en REVISION */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M5", async (req, ctx) => {
  const id = (await paramsDe(ctx)).id;
  const b = await parseBody(req, schema);
  const r = await resolverEvento(ctx.localId, BigInt(id), b.accion, ctx.session.sub);
  await auditar(ctx, { localId: ctx.localId, accion: "KIOSCO_RESOLVER", entidad: "evento_kiosco", entidadId: id, humana: b.accion === "DESCARTAR" ? "Descartó un evento del kiosco" : "Emitió un turno pendiente del kiosco" });
  return ok(r);
});
