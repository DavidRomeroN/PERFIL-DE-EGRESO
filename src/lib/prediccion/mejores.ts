import { prisma } from "@/lib/db";

/** Horas del día con menor espera media, a partir de turnos ya atendidos. */
export async function mejoresHoras(colaId: number) {
  const rows = await prisma.turno.findMany({
    where: { colaId, estado: "ATENDIDO", llamadoAt: { not: null } },
    select: { emitidoAt: true, llamadoAt: true },
    take: 500,
    orderBy: { id: "desc" },
  });
  const porHora = new Map<number, number[]>();
  for (const t of rows) {
    const min = (t.llamadoAt!.getTime() - t.emitidoAt.getTime()) / 60000;
    if (min <= 0 || min > 240) continue;
    const h = t.emitidoAt.getHours();
    porHora.set(h, [...(porHora.get(h) ?? []), min]);
  }
  return [...porHora.entries()]
    .map(([hora, xs]) => ({ hora, esperaMin: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), muestra: xs.length }))
    .filter((x) => x.muestra >= 3)
    .sort((a, b) => a.esperaMin - b.esperaMin)
    .slice(0, 3);
}
