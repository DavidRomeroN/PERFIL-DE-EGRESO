import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { fechaLocalHaceDias, reporteEspera, snapshotLocal } from "@backend/turnos";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");

  const hoy = fechaLocalHaceDias(0, local.zonaHoraria);
  const hace6 = fechaLocalHaceDias(6, local.zonaHoraria);
  const [snap, reporte] = await Promise.all([snapshotLocal(local.slug, { incluirNombres: true }), reporteEspera(local.id, hace6, hoy)]);

  return <Dashboard inicial={JSON.parse(JSON.stringify(snap))} semana={JSON.parse(JSON.stringify(reporte))} />;
}
