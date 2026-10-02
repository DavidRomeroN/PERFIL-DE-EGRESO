import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorNegocio, obtenerTurnoPorToken } from "@/lib/turnos";
import { Ticket } from "./ticket";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await obtenerTurnoPorToken(token).catch((e: unknown) => {
    if (e instanceof ErrorNegocio && e.status === 404) notFound();
    throw e;
  });
  return (
    <Ticket
      codigo={t.codigo}
      cola={t.cola.nombre}
      local={t.local.nombreComercial}
      direccion={t.local.direccion}
      emitidoAt={t.emitidoAt.toISOString()}
      personasDelante={t.personasDelante}
      tiempoEstimadoSeg={t.tiempoEstimadoSeg}
      urlSeguimiento={t.urlSeguimiento}
      nombre={t.cliente.nombre}
    />
  );
}
