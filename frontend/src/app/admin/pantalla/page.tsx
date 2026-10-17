import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { PantallaAdmin } from "./pantalla-admin";
import { claveTv } from "@backend/pantalla";

export const metadata: Metadata = { title: "Pantalla TV y QR" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  return (
    <PantallaAdmin
      local={{
        slug: local.slug,
        nombreComercial: local.nombreComercial,
        direccion: local.direccion,
        colorPrimario: local.colorPrimario,
        logoUrl: local.logoUrl ?? "",
        mensajeTv: local.mensajeTv ?? "",
        mensajeBienvenida: local.mensajeBienvenida ?? "",
        avisarFaltando: local.avisarFaltando,
      }}
      claveTv={claveTv(local.id)}
    />
  );
}
