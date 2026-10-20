import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal } from "@backend/rutas";
import { crearRegla } from "@backend/balanceo/service";
import { accionSchema, condicionSchema } from "@backend/balanceo/reglas";

const reglaSchema = z.object({
  nombre: z.string().trim().min(3).max(80),
  condicion: condicionSchema,
  accion: accionSchema,
  forSegundos: z.number().int().min(0).max(3600).optional(),
  forSegundosReversa: z.number().int().min(0).max(3600).optional(),
  cooldownSeg: z.number().int().min(120).max(86400).optional(),
  histeresisPct: z.number().int().min(0).max(80).optional(),
  ttlSeg: z.number().int().min(60).max(86400).nullable().optional(),
  requiereConfirmacion: z.boolean().optional(),
  prioridad: z.number().int().min(1).max(1000).optional(),
});

export const GET = enLocal(ADMIN, "M6", async (_req, ctx) => ok(await prisma.reglaBalanceo.findMany({ where: { localId: ctx.localId }, include: { estado: true }, orderBy: [{ prioridad: "asc" }, { id: "asc" }] })));

/** POST /api/v1/balanceo/reglas — toda regla nace en SIMULACION (RN-M6-09) */
export const POST = enLocal(ADMIN, "M6", async (req, ctx) => ok(await crearRegla(ctx, ctx.localId, await parseBody(req, reglaSchema)), { status: 201 }));
