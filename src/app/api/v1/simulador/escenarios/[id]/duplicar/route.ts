import { ok, paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { duplicarEscenario } from "@/lib/capacidad/service";

export const POST = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M8", async (_req, ctx) => ok(await duplicarEscenario(ctx.localId, Number((await paramsDe(ctx)).id), ctx.session.sub), { status: 201 }));
