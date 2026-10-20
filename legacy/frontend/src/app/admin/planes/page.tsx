import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { Planes } from "./planes";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (session?.rol !== "SUPER_ADMIN") redirect("/admin");
  return <Planes />;
}
