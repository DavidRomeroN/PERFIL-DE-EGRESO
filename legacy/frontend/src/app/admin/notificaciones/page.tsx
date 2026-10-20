import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { nombreProveedorActivo } from "@backend/whatsapp";
import { NotificacionesAdmin } from "./notificaciones-admin";

export const metadata: Metadata = { title: "Avisos WhatsApp" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  return <NotificacionesAdmin slug={local.slug} proveedor={nombreProveedorActivo()} whatsappHabilitado={local.plan.whatsappHabilitado} maxAvisos={local.plan.maxAvisosWhatsapp} />;
}
