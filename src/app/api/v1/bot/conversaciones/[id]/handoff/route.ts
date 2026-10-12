import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { cambiarHandoff } from "@/lib/bot/service";

const schema = z.object({ activo: z.boolean() });

/** POST /api/v1/bot/conversaciones/:id/handoff — tomar el control o devolverlo al bot */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M4", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await cambiarHandoff(ctx.localId, (await paramsDe(ctx)).id, b.activo));
});
