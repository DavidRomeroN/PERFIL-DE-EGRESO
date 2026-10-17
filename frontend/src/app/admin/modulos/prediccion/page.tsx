import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { prisma } from "@backend/db";
import { Prediccion } from "./prediccion";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  const colas = await prisma.cola.findMany({ where: { localId: local.id, activa: true }, orderBy: { orden: "asc" }, select: { id: true, nombre: true } });
  return <Prediccion colas={colas} />;
}
