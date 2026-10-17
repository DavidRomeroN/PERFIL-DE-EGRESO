import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { prisma } from "@backend/db";
import { ConfiguracionAdmin } from "./configuracion-admin";

export const metadata: Metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");

  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(0, 0, 0, 0);
  const [turnosMes, avisosMes, counts] = await Promise.all([
    prisma.turno.count({ where: { localId: local.id, fecha: { gte: inicioMes } } }),
    prisma.notificacion.count({ where: { tipo: "WHATSAPP", createdAt: { gte: inicioMes }, turno: { localId: local.id } } }),
    prisma.local.findUnique({ where: { id: local.id }, select: { _count: { select: { colas: true, ventanillas: true, usuarios: true } } } }),
  ]);

  return (
    <ConfiguracionAdmin
      local={{
        nombreComercial: local.nombreComercial,
        razonSocial: local.razonSocial,
        ruc: local.ruc ?? "",
        rubro: local.rubro,
        direccion: local.direccion ?? "",
        telefono: local.telefono ?? "",
        slug: local.slug,
        zonaHoraria: local.zonaHoraria,
      }}
      plan={{
        nombre: local.plan.nombre,
        codigo: local.plan.codigo,
        precio: Number(local.plan.precioMensual),
        maxTurnosMes: local.plan.maxTurnosMes,
        maxColas: local.plan.maxColas,
        maxVentanillas: local.plan.maxVentanillas,
        whatsapp: local.plan.whatsappHabilitado,
        maxAvisos: local.plan.maxAvisosWhatsapp,
      }}
      uso={{ turnosMes, avisosMes, colas: counts?._count.colas ?? 0, ventanillas: counts?._count.ventanillas ?? 0, usuarios: counts?._count.usuarios ?? 0 }}
    />
  );
}
