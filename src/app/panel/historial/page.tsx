import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Historial } from "./historial";

export const metadata: Metadata = { title: "Historial del día" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login?next=/panel/historial");
  return <Historial />;
}
