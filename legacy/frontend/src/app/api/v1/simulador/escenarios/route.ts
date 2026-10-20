import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { crearEscenario, listarEscenarios } from "@backend/capacidad/service";

const schema = z.object({ nombre: z.string().trim().min(2).max(80), colaId: z.number().int().positive().nullable().optional(), parametros: z.record(z.string(), z.unknown()), resultados: z.record(z.string(), z.unknown()).optional(), semilla: z.number().int().min(0).max(2 ** 31) });

export const GET = enLocal(ADMIN, "M8", async (_req, ctx) => ok(await listarEscenarios(ctx.localId)));
export const POST = enLocal(ADMIN, "M8", async (req, ctx) => ok(await crearEscenario(ctx.localId, ctx.session.sub, await parseBody(req, schema)), { status: 201 }));
