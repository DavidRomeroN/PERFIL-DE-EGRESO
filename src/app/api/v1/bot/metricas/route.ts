import { ok } from "@/lib/api";
import { ADMIN, enLocal, qNum } from "@/lib/rutas";
import { metricasBot } from "@/lib/bot/service";

export const GET = enLocal(ADMIN, "M4", async (req, ctx) => ok(await metricasBot(ctx.localId, Math.min(30, qNum(req, "dias") ?? 7))));
