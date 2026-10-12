import { ok, paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { mensajes } from "@/lib/bot/service";

export const GET = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M4", async (_req, ctx) => ok(await mensajes(ctx.localId, (await paramsDe(ctx)).id)));
