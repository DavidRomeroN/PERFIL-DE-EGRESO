import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { LocalesAdmin } from "./locales-admin";

export const metadata: Metadata = { title: "Locales y planes" };

export default async function Page() {
  const session = await getSession();
  if (!session || session.rol !== "SUPER_ADMIN") redirect("/admin");
  return <LocalesAdmin />;
}
