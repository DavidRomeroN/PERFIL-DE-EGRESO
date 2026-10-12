import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { tiempoEstimado } from "@/lib/turnos";
import { TomarTurno } from "./tomar-turno";

export const dynamic = "force-dynamic";

async function cargarLocal(slug: string) {
  const local = await prisma.local.findUnique({
    where: { slug },
    include: { plan: true, colas: { where: { activa: true }, orderBy: { orden: "asc" } } },
  });
  if (!local || !local.activo) return null;
  const colas = await Promise.all(
    local.colas.map(async (c) => {
      const enEspera = await prisma.turno.count({ where: { colaId: c.id, estado: { in: ["EMITIDO", "AVISADO"] } } });
      return { id: c.id, prefijo: c.prefijo, nombre: c.nombre, descripcion: c.descripcion, enEspera, tiempoEstimadoSeg: await tiempoEstimado(c.id, enEspera + 1) };
    }),
  );
  const categorias = local.plan.codigo === "GRATIS" ? [] : await prisma.categoriaPrioridad.findMany({
    where: { localId: local.id, activa: true, visibleCliente: true, codigo: { not: "GENERAL" } },
    select: { codigo: true, nombre: true },
    orderBy: { orden: "asc" },
  });
  return { local, colas, categorias };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const l = await prisma.local.findUnique({ where: { slug }, select: { nombreComercial: true } });
  return { title: l ? `Tomar turno · ${l.nombreComercial}` : "Local no encontrado" };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await cargarLocal(slug);
  if (!data) notFound();
  const { local, colas, categorias } = data;

  return (
    <TomarTurno
      local={{
        slug: local.slug,
        nombreComercial: local.nombreComercial,
        rubro: local.rubro,
        direccion: local.direccion,
        colorPrimario: local.colorPrimario,
        logoUrl: local.logoUrl,
        mensajeBienvenida: local.mensajeBienvenida,
        avisarFaltando: local.avisarFaltando,
        whatsappHabilitado: local.plan.whatsappHabilitado,
      }}
      colas={colas}
      categorias={categorias}
    />
  );
}
