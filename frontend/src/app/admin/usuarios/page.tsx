import type { Metadata } from "next";
import { getSession } from "@backend/auth";
import { UsuariosAdmin } from "./usuarios-admin";

export const metadata: Metadata = { title: "Usuarios" };

export default async function Page() {
  const session = await getSession();
  return <UsuariosAdmin miId={session?.sub ?? 0} />;
}
