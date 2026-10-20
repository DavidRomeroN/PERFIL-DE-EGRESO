import { z } from "zod";
import { auditar, ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { editarDispositivo } from "@backend/kiosco/service";

const schema = z.object({ nombre: z.string().trim().min(2).max(40).optional(), colaIds: z.array(z.number().int().positive()).max(20).optional(), pin: z.string().regex(/^\d{4,8}$/).optional() });
type P = { params: Promise<{ id: string }> };

export const PATCH = enLocal<P>(ADMIN, "M5", async (req, ctx) => ok(await editarDispositivo(ctx.localId, Number((await paramsDe(ctx)).id), await parseBody(req, schema))));

/** DELETE = revocar: el kiosco deja de emitir y muestra "Dispositivo no autorizado" (RN-M5-09) */
export const DELETE = enLocal<P>(ADMIN, "M5", async (_req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const r = await editarDispositivo(ctx.localId, id, { activo: false });
  await auditar(ctx, { localId: ctx.localId, accion: "KIOSCO_REVOCAR", entidad: "dispositivo_kiosco", entidadId: id, humana: `Revocó el kiosco ${r.prefijo}` });
  return ok(r);
});
