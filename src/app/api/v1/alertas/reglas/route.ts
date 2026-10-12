import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";
import { sembrarReglasAlerta } from "@/lib/analitica/alertas";
import type { Prisma } from "@/generated/prisma/client";

const TIPOS = ["SLA_INCUMPLIDO", "ESPERA_ALTA", "COLA_LARGA", "ANOMALIA_LLEGADAS", "VENTANILLA_INACTIVA", "WHATSAPP_CAIDO", "KIOSCO_OFFLINE"] as const;
const schema = z.object({ tipo: z.enum(TIPOS), nombre: z.string().trim().min(3).max(80), umbral: z.record(z.string(), z.number()), niveles: z.array(z.object({ traMin: z.number().int().min(0).max(1440), canales: z.array(z.enum(["IN_APP", "WHATSAPP", "CORREO"])).min(1), usuarios: z.array(z.number().int()).optional() })).min(1).max(3), resolverTrasMin: z.number().int().min(1).max(240).default(10) });

export const GET = enLocal(ADMIN, "M7", async (_req, ctx) => {
  await sembrarReglasAlerta(ctx.localId);
  return ok(await prisma.reglaAlerta.findMany({ where: { localId: ctx.localId }, orderBy: { id: "asc" } }));
});

export const POST = enLocal(ADMIN, "M7", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await prisma.reglaAlerta.create({ data: { localId: ctx.localId, tipo: b.tipo, nombre: b.nombre, umbral: b.umbral as Prisma.InputJsonValue, niveles: b.niveles as Prisma.InputJsonValue, resolverTrasMin: b.resolverTrasMin } }), { status: 201 });
});
