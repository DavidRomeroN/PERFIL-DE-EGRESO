"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

interface Cita {
  token: string;
  codigoCheckin: string;
  estado: string;
  inicioLocal: string;
  cola: { id: number; nombre: string };
  local: { slug: string; nombreComercial: string; direccion: string | null };
  urlQr: string;
  turno: { token: string; codigo: string; estado: string } | null;
  checkin: { ventana: string; disponibleDesde: string | null; antesMin: number; despuesMin: number };
  puedeCancelar: boolean;
}

const ESTADOS: Record<string, string> = { RESERVADA: "Reservada", CONFIRMADA: "Confirmada", CHECKIN: "Ya llegaste", ATENDIDA: "Atendida", NO_SHOW: "No asististe", CANCELADA: "Cancelada" };

/** M3 · Detalle de la cita: confirmar, cancelar, check-in con PIN de presencia y enlace al turno. */
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [cita, setCita] = useState<Cita | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = useCallback(() => api<Cita>(`/api/v1/public/citas/${token}`).then(setCita).catch((e) => setError(e.message)), [token]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function hacer(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null); setError(null);
    try { await fn(); if (ok) setMsg(ok); await cargar(); } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }

  if (!cita) return <main className="p-8 text-center text-muted-foreground">{error ?? "Cargando…"}</main>;
  const activa = ["RESERVADA", "CONFIRMADA"].includes(cita.estado);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">{cita.local.nombreComercial}</p>
      <h1 className="text-2xl font-bold">Tu cita</h1>
      <p className="text-lg">{cita.cola.nombre}<br /><b className="capitalize">{cita.inicioLocal}</b></p>
      <p><span className="rounded-full bg-muted px-3 py-1 text-sm">{ESTADOS[cita.estado] ?? cita.estado}</span></p>
      {cita.local.direccion && <p className="text-sm text-muted-foreground">{cita.local.direccion}</p>}
      {msg && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {cita.turno && (
        <Button asChild className="h-12"><Link href={`/t/${cita.turno.token}`}>Ver mi turno {cita.turno.codigo}</Link></Button>
      )}

      {activa && (
        <>
          <div className="mx-auto"><QRCodeSVG value={cita.urlQr} size={170} /></div>
          <p>Código para el kiosco: <b className="font-mono text-xl">{cita.codigoCheckin}</b></p>
          {cita.checkin.ventana === "TEMPRANO" && cita.checkin.disponibleDesde && (
            <p aria-live="polite" className="text-sm text-muted-foreground">El check-in se habilita desde las {new Date(cita.checkin.disponibleDesde).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" })} ({cita.checkin.antesMin} min antes).</p>
          )}
          {(cita.checkin.ventana === "DENTRO" || cita.checkin.ventana === "TARDE") && (
            <div className="space-y-2 rounded-2xl border p-4">
              <p className="font-medium">¿Ya llegaste? Escribe el PIN que aparece en la pantalla del local</p>
              {cita.checkin.ventana === "TARDE" && <p className="text-sm text-amber-700">Llegaste tarde: entrarás a la fila como turno general.</p>}
              <Input inputMode="numeric" maxLength={4} aria-label="PIN de presencia" className="text-center font-mono text-2xl tracking-[0.5em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              <Button className="h-12 w-full" disabled={pin.length !== 4} onClick={() => hacer(async () => { const r = await api<{ turnoToken: string }>(`/api/v1/public/citas/${token}/checkin`, { method: "POST", json: { pin } }); router.push(`/t/${r.turnoToken}`); })}>Hacer check-in</Button>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {cita.estado === "RESERVADA" && <Button variant="outline" onClick={() => hacer(() => api(`/api/v1/public/citas/${token}/confirmar`, { method: "POST" }), "Cita confirmada")}>Confirmar asistencia</Button>}
            <Button asChild variant="outline"><a href={`/api/v1/public/citas/${token}/ics`}>Agregar al calendario</a></Button>
            <Button asChild variant="outline"><Link href={`/l/${cita.local.slug}/citas`}>Reservar otro horario</Link></Button>
            {cita.puedeCancelar && <Button variant="ghost" className="text-rose-700" onClick={() => confirm("¿Cancelar la cita?") && hacer(() => api(`/api/v1/public/citas/${token}`, { method: "DELETE" }), "Cita cancelada; el cupo quedó libre")}>Cancelar cita</Button>}
          </div>
        </>
      )}
    </main>
  );
}
