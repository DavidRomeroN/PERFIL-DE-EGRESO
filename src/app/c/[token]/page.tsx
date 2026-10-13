"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { AlertCircle, CalendarPlus, CheckCircle2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

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
const TONO: Record<string, string> = {
  RESERVADA: "bg-slate-100 text-slate-700",
  CONFIRMADA: "bg-teal-100 text-teal-800",
  CHECKIN: "bg-emerald-100 text-emerald-800",
  ATENDIDA: "bg-emerald-100 text-emerald-800",
  NO_SHOW: "bg-rose-100 text-rose-800",
  CANCELADA: "bg-zinc-100 text-zinc-600",
};

/** M3 · Detalle de la cita: confirmar, cancelar, check-in con PIN de presencia y enlace al turno. */
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [cita, setCita] = useState<Cita | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const cargar = useCallback(() => api<Cita>(`/api/v1/public/citas/${token}`).then(setCita).catch((e) => setError(e.message)), [token]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function hacer(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null); setError(null);
    try { await fn(); if (ok) setMsg(ok); await cargar(); } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
  }

  if (!cita) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-6" aria-busy={!error}>
        {error ? (
          <p role="alert" className="flex animate-enter items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>
        ) : (
          <>
            <div className="skeleton mx-auto h-5 w-40 rounded-lg" />
            <div className="skeleton mx-auto h-8 w-32 rounded-lg" />
            <div className="skeleton h-72 rounded-3xl" />
          </>
        )}
      </main>
    );
  }
  const activa = ["RESERVADA", "CONFIRMADA"].includes(cita.estado);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-6 text-center">
      <div className="animate-enter">
        <p className="text-sm text-muted-foreground">{cita.local.nombreComercial}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Tu cita</h1>
      </div>
      <section className="animate-enter-soft space-y-4 rounded-3xl bg-card p-6 shadow-float ring-1 ring-foreground/5 [animation-delay:80ms]">
        <p className="text-lg">{cita.cola.nombre}<br /><b className="capitalize">{cita.inicioLocal}</b></p>
        <p><span key={cita.estado} className={cn("inline-block animate-pop rounded-full px-3 py-1 text-sm font-medium", TONO[cita.estado] ?? "bg-muted")}>{ESTADOS[cita.estado] ?? cita.estado}</span></p>
        {cita.local.direccion && <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" /> {cita.local.direccion}</p>}
        {msg && <p role="status" className="flex animate-enter items-center justify-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="size-4" /> {msg}</p>}
        {error && <p role="alert" className="animate-shake rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {cita.turno && (
          <Button asChild className="h-12 w-full"><Link href={`/t/${cita.turno.token}`}>Ver mi turno {cita.turno.codigo}</Link></Button>
        )}

        {activa && (
          <>
            <div className="mx-auto w-fit animate-pop rounded-2xl bg-white p-3 shadow-soft ring-1 ring-border [animation-delay:200ms]"><QRCodeSVG value={cita.urlQr} size={170} /></div>
            <p>Código para el kiosco: <b className="font-mono text-xl tracking-wider">{cita.codigoCheckin}</b></p>
            {cita.checkin.ventana === "TEMPRANO" && cita.checkin.disponibleDesde && (
              <p aria-live="polite" className="text-sm text-muted-foreground">El check-in se habilita desde las {new Date(cita.checkin.disponibleDesde).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" })} ({cita.checkin.antesMin} min antes).</p>
            )}
            {(cita.checkin.ventana === "DENTRO" || cita.checkin.ventana === "TARDE") && (
              <div className="animate-enter space-y-3 rounded-2xl border p-4">
                <p className="font-medium">¿Ya llegaste? Escribe el PIN que aparece en la pantalla del local</p>
                {cita.checkin.ventana === "TARDE" && <p className="text-sm text-amber-700">Llegaste tarde: entrarás a la fila como turno general.</p>}
                <Input inputMode="numeric" maxLength={4} aria-label="PIN de presencia" className="h-14 text-center font-mono text-2xl tracking-[0.5em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
                <Button className="h-12 w-full" disabled={pin.length !== 4} onClick={() => hacer(async () => { const r = await api<{ turnoToken: string }>(`/api/v1/public/citas/${token}/checkin`, { method: "POST", json: { pin } }); router.push(`/t/${r.turnoToken}`); })}>Hacer check-in</Button>
              </div>
            )}
          </>
        )}
      </section>

      {activa && (
        <div className="flex animate-enter flex-wrap justify-center gap-2 [animation-delay:160ms]">
          {cita.estado === "RESERVADA" && <Button variant="outline" onClick={() => hacer(() => api(`/api/v1/public/citas/${token}/confirmar`, { method: "POST" }), "Cita confirmada")}>Confirmar asistencia</Button>}
          <Button asChild variant="outline"><a href={`/api/v1/public/citas/${token}/ics`}><CalendarPlus className="size-4" /> Agregar al calendario</a></Button>
          <Button asChild variant="outline"><Link href={`/l/${cita.local.slug}/citas`}>Reservar otro horario</Link></Button>
          {cita.puedeCancelar && <Button variant="ghost" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setConfirmarCancelar(true)}>Cancelar cita</Button>}
        </div>
      )}

      <ConfirmDialog
        open={confirmarCancelar}
        onOpenChange={setConfirmarCancelar}
        title="¿Cancelar la cita?"
        description="El horario quedará libre para otra persona. Si cambias de opinión tendrás que reservar de nuevo."
        confirmLabel="Sí, cancelar"
        loading={cancelando}
        onConfirm={async () => {
          setCancelando(true);
          await hacer(() => api(`/api/v1/public/citas/${token}`, { method: "DELETE" }), "Cita cancelada; el cupo quedó libre");
          setCancelando(false);
          setConfirmarCancelar(false);
        }}
      />
    </main>
  );
}
