import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { localActualAdmin } from "@backend/admin";
import { estadoModulos } from "@backend/modulos";
import { HubModulos } from "./hub";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  return <HubModulos inicial={await estadoModulos(local.id)} plan={local.plan.nombre} />;
}
