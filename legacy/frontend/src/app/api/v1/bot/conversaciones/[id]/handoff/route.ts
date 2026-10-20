import { z } from "zod";
import { ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { cambiarHandoff } from "@backend/bot/service";

const schema = z.object({ activo: z.boolean() });

/** POST /api/v1/bot/conversaciones/:id/handoff — tomar el control o devolverlo al bot */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M4", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await cambiarHandoff(ctx.localId, (await paramsDe(ctx)).id, b.activo));
});
