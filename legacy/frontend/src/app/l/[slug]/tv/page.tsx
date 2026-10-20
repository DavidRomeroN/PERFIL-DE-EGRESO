import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorNegocio, snapshotLocal } from "@backend/turnos";
import { PantallaTv } from "./pantalla-tv";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Pantalla · ${slug}` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const { k } = await searchParams;
  const snap = await snapshotLocal(slug).catch((e: unknown) => {
    if (e instanceof ErrorNegocio && e.status === 404) notFound();
    throw e;
  });
  return <PantallaTv inicial={JSON.parse(JSON.stringify(snap))} claveTv={k ?? null} />;
}
