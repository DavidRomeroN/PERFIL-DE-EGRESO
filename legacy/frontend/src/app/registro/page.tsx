import type { Metadata } from "next";
import { prisma } from "@backend/db";
import { Registro } from "./registro";

export const metadata: Metadata = { title: "Crear mi local" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { plan } = await searchParams;
  const planes = await prisma.plan.findMany({ where: { codigo: { in: ["GRATIS", "EMPRENDE", "PRO"] } }, orderBy: { precioMensual: "asc" } });
  return (
    <Registro
      planes={planes.map((p) => ({ codigo: p.codigo, nombre: p.nombre, precio: Number(p.precioMensual), descripcion: p.descripcion }))}
      inicial={planes.some((p) => p.codigo === plan) ? plan! : "EMPRENDE"}
    />
  );
}
