import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { crearCategoria } from "@/lib/prioridades/service";

const categoriaSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,16}$/, "Usa mayúsculas, números o _ (2–16)"),
  nombre: z.string().trim().min(2).max(60),
  icono: z.string().trim().max(40).optional().nullable(),
  pesoBase: z.number().int().min(0).max(1000),
  absoluta: z.boolean().optional().default(false),
  documento: z.enum(["NINGUNO", "DNI", "CARNE_GESTANTE", "CONADIS", "TRIAJE"]).optional().default("NINGUNO"),
  esperaMaxSeg: z.number().int().min(0).max(14400).optional().nullable(),
  visibleCliente: z.boolean().optional().default(true),
  activa: z.boolean().optional().default(true),
  orden: z.number().int().min(0).max(100).optional().default(10),
});

/** POST /api/v1/prioridades/categorias */
export const POST = enLocal(ADMIN, "M1", async (req, ctx) => ok(await crearCategoria(ctx, ctx.localId, await parseBody(req, categoriaSchema)), { status: 201 }));
