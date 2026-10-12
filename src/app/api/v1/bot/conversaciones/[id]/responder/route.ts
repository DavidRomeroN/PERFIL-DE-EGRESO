import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { responderComoPersona } from "@/lib/bot/service";

const schema = z.object({ texto: z.string().min(1).max(1000) });

/** POST /api/v1/bot/conversaciones/:id/responder — solo en atención humana */
export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M4", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await responderComoPersona(ctx.localId, (await paramsDe(ctx)).id, b.texto, ctx.session.sub));
});
