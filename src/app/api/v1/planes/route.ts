import { ok, publico } from "@/lib/api";
import { prisma } from "@/lib/db";

/** GET /api/v1/planes — planes y precios (público, alimenta la landing) */
export const GET = publico(async () => {
  const planes = await prisma.plan.findMany({ orderBy: { precioMensual: "asc" } });
  return ok(planes);
});
