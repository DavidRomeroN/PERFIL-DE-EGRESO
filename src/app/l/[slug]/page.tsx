import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { tiempoEstimado } from "@/lib/turnos";
import Link from "next/link";
import { TomarTurno } from "./tomar-turno";
import { modulosActivos } from "@/lib/modulos";
import { localAbierto } from "@/lib/operacion";
import { fechaADate, fechaLocalISO } from "@/lib/fechas";

export const dynamic = "force-dynamic";

async function cargarLocal(slug: string) {
  const local = await prisma.local.findUnique({
    where: { slug },
    include: { plan: true, colas: { where: { activa: true }, orderBy: { orden: "asc" } } },
  });
  if (!local || !local.activo) return null;
  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria));
  const activos = await modulosActivos(local.id);
  const colas = await Promise.all(
    local.colas.map(async (c) => {
      const enEspera = await prisma.turno.count({ where: { colaId: c.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] } } });
      return { id: c.id, prefijo: c.prefijo, nombre: c.nombre, descripcion: c.descripcion, enEspera, tiempoEstimadoSeg: await tiempoEstimado(c.id, enEspera + 1) };
    }),
  );
  const categorias = !activos.has("M1") ? [] : await prisma.categoriaPrioridad.findMany({
    where: { localId: local.id, activa: true, visibleCliente: true, codigo: { not: "GENERAL" } },
    select: { codigo: true, nombre: true },
    orderBy: { orden: "asc" },
  });
  const horario = await localAbierto(local.id, local.zonaHoraria);
  const conCitas = activos.has("M3") && (await prisma.configCitas.count({ where: { activo: true, cola: { localId: local.id } } })) > 0;
  return { local, colas, categorias, horario, conCitas };
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
  const { local, colas, categorias, horario, conCitas } = data;

  return (
    <>
    {(!horario.abierto || conCitas) && (
      <div className="mx-auto max-w-lg px-4 pt-4 text-sm">
        {!horario.abierto && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">{horario.mensaje ?? "Esta cola está cerrada ahora."}</p>}
        {conCitas && <p className="mt-2 text-center"><Link href={`/l/${local.slug}/citas`} className="font-medium underline">¿Prefieres reservar un horario? Agenda una cita</Link></p>}
      </div>
    )}
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
    </>
  );
}
