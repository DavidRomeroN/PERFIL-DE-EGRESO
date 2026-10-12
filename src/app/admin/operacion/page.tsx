import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { localActualAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { OperacionAdmin } from "./operacion-admin";

export const metadata: Metadata = { title: "Operación" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  const [categorias, config, horarios, colas, espera] = await Promise.all([
    prisma.categoriaPrioridad.findMany({ where: { localId: local.id }, orderBy: { orden: "asc" } }),
    prisma.configPrioridad.findUnique({ where: { localId: local.id } }),
    prisma.horarioLocal.findMany({ where: { localId: local.id }, orderBy: { diaSemana: "asc" } }),
    prisma.cola.findMany({ where: { localId: local.id, activa: true }, orderBy: { orden: "asc" } }),
    prisma.turno.findMany({ where: { localId: local.id, estado: { in: ["EMITIDO", "AVISADO"] } }, orderBy: { emitidoAt: "asc" }, take: 30, include: { cola: true } }),
  ]);
  return (
    <OperacionAdmin
      categorias={categorias.map((c) => ({ codigo: c.codigo, nombre: c.nombre, pesoBase: c.pesoBase }))}
      config={{ alfa: Number(config?.alfaPuntosPorMin ?? 0), tope: config?.topeAdelantos ?? 3, ausenciaSeg: local.tiempoAusenciaSeg ?? 180 }}
      horarios={horarios.map((h) => ({ diaSemana: h.diaSemana, apertura: h.apertura, cierre: h.cierre, activo: h.activo }))}
      colas={colas.map((c) => ({ id: c.id, nombre: c.nombre }))}
      espera={espera.map((t) => ({ id: t.id, codigo: t.codigo, cola: t.cola.nombre }))}
    />
  );
}
