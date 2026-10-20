import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorNegocio, obtenerTurnoPorToken } from "@backend/turnos";
import { MiTurno } from "./mi-turno";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  try {
    const t = await obtenerTurnoPorToken(token);
    return { title: `Turno ${t.codigo} · ${t.local.nombreComercial}` };
  } catch {
    return { title: "Turno no encontrado" };
  }
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let turno;
  try {
    turno = await obtenerTurnoPorToken(token);
  } catch (e) {
    if (e instanceof ErrorNegocio && e.status === 404) notFound();
    throw e;
  }
  return <MiTurno inicial={JSON.parse(JSON.stringify(turno))} />;
}
