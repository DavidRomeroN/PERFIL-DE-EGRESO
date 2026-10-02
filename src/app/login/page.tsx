import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.rol === "OPERADOR" ? "/panel" : "/admin");
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
