import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { prisma } from "@backend/db";
import { AdminShell } from "./admin-shell";
import { modulosActivos } from "@backend/modulos";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (session.rol === "OPERADOR") redirect("/panel");

  const local = await localActualAdmin(session);
  const locales =
    session.rol === "SUPER_ADMIN"
      ? await prisma.local.findMany({ orderBy: { id: "asc" }, select: { id: true, slug: true, nombreComercial: true, activo: true } })
      : [];

  const modulos = local ? [...(await modulosActivos(local.id))] : [];

  return (
    <AdminShell
      modulos={modulos}
      session={session}
      local={local ? { id: local.id, slug: local.slug, nombreComercial: local.nombreComercial, colorPrimario: local.colorPrimario, plan: local.plan.nombre, planCodigo: local.plan.codigo } : null}
      locales={locales}
    >
      {children}
    </AdminShell>
  );
}
