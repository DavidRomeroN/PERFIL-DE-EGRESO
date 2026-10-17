import { z } from "zod";
import { ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { editarEscenario, eliminarEscenario, obtenerEscenario } from "@backend/capacidad/service";

type P = { params: Promise<{ id: string }> };
const schema = z.object({ nombre: z.string().trim().min(2).max(80).optional(), resultados: z.record(z.string(), z.unknown()).optional() });

export const GET = enLocal<P>(ADMIN, "M8", async (_req, ctx) => ok(await obtenerEscenario(ctx.localId, Number((await paramsDe(ctx)).id))));
export const PATCH = enLocal<P>(ADMIN, "M8", async (req, ctx) => ok(await editarEscenario(ctx.localId, Number((await paramsDe(ctx)).id), await parseBody(req, schema))));
export const DELETE = enLocal<P>(ADMIN, "M8", async (_req, ctx) => {
  await eliminarEscenario(ctx.localId, Number((await paramsDe(ctx)).id));
  return ok({ eliminado: true });
});
