import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { editarCategoria, eliminarCategoria } from "@/lib/prioridades/service";

const schema = z.object({
  nombre: z.string().trim().min(2).max(60).optional(),
  icono: z.string().trim().max(40).optional().nullable(),
  pesoBase: z.number().int().min(0).max(1000).optional(),
  absoluta: z.boolean().optional(),
  documento: z.enum(["NINGUNO", "DNI", "CARNE_GESTANTE", "CONADIS", "TRIAJE"]).optional(),
  esperaMaxSeg: z.number().int().min(0).max(14400).optional().nullable(),
  visibleCliente: z.boolean().optional(),
  activa: z.boolean().optional(),
  orden: z.number().int().min(0).max(100).optional(),
});

type P = { params: Promise<{ id: string }> };

/** PATCH /api/v1/prioridades/categorias/:id */
export const PATCH = enLocal<P>(ADMIN, "M1", async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  return ok(await editarCategoria(ctx, ctx.localId, Number(id), await parseBody(req, schema)));
});

/** DELETE /api/v1/prioridades/categorias/:id — borrado lógico si tiene turnos; GENERAL no se elimina */
export const DELETE = enLocal<P>(ADMIN, "M1", async (_req, ctx) => {
  const { id } = await paramsDe(ctx);
  return ok(await eliminarCategoria(ctx, ctx.localId, Number(id)));
});
