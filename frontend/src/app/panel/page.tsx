import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@backend/auth";
import { prisma } from "@backend/db";
import { PanelVentanilla } from "./panel-ventanilla";

export const metadata: Metadata = { title: "Panel de ventanilla" };
export const dynamic = "force-dynamic";

export default async function PanelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/panel");

  let slug = session.localSlug;
  if (session.rol === "SUPER_ADMIN") {
    const sp = await searchParams;
    const pedido = typeof sp.slug === "string" ? sp.slug : null;
    slug = pedido ?? (await prisma.local.findFirst({ where: { activo: true }, orderBy: { id: "asc" }, select: { slug: true } }))?.slug ?? null;
  }
  if (!slug) redirect("/admin/locales");

  const locales = session.rol === "SUPER_ADMIN" ? await prisma.local.findMany({ where: { activo: true }, select: { slug: true, nombreComercial: true }, orderBy: { id: "asc" } }) : [];

  return <PanelVentanilla session={session} slug={slug} locales={locales} />;
}
