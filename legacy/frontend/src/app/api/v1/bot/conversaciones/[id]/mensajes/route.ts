import { ok, paramsDe } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { mensajes } from "@backend/bot/service";

export const GET = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M4", async (_req, ctx) => ok(await mensajes(ctx.localId, (await paramsDe(ctx)).id)));
