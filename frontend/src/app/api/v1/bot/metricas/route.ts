import { ok } from "@backend/api";
import { ADMIN, enLocal, qNum } from "@backend/rutas";
import { metricasBot } from "@backend/bot/service";

export const GET = enLocal(ADMIN, "M4", async (req, ctx) => ok(await metricasBot(ctx.localId, Math.min(30, qNum(req, "dias") ?? 7))));
