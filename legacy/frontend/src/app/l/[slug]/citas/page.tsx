"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { CalendarPlus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CabeceraLocal } from "@/components/app/cabecera-local";
import { CheckAnimado } from "@/components/app/motion";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

interface Info { disponible: boolean; local?: { nombre: string; color: string }; colas: { id: number; nombre: string; descripcion: string | null }[] }
interface Dia { fecha: string; abierto: boolean; libres: number }
interface Slot { id: number; hora: string; restantes: number; disponible: boolean }
interface Cita { token: string; codigoCheckin: string; inicioLocal: string; cola: { nombre: string }; urlQr: string }

/** Título de cada paso con su número; el número se vuelve un check cuando el paso quedó resuelto. */
function Paso({ n, titulo, hecho, color }: { n: number; titulo: string; hecho: boolean; color: string }) {
  return (
    <h2 className="flex items-center gap-2 font-semibold">
      <span className={cn("flex size-6 items-center justify-center rounded-full text-xs text-white transition-colors duration-300", !hecho && "bg-muted-foreground/40")} style={hecho ? { background: color } : undefined}>
        {hecho ? <Check className="size-3.5 animate-pop" /> : n}
      </span>
      {titulo}
    </h2>
  );
}

/** M3 · Reserva: servicio → día (14 días) → horario → datos y consentimiento → confirmación con QR. */
export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [cola, setCola] = useState<number | null>(null);
  const [dias, setDias] = useState<Dia[]>([]);
  const [fecha, setFecha] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [datos, setDatos] = useState({ nombre: "", telefono: "", consentimiento: false });
  const [cita, setCita] = useState<Cita | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));

  useEffect(() => { api<Info>(`/api/v1/public/locales/${slug}/citas`).then((i) => { setInfo(i); if (i.colas.length === 1) setCola(i.colas[0].id); }).catch((e) => setError(e.message)); }, [slug]);
  useEffect(() => {
    if (!cola) return;
    setFecha(null); setSlots(null); setSlot(null);
    api<Dia[]>(`/api/v1/public/locales/${slug}/disponibilidad?colaId=${cola}`).then(setDias).catch((e) => setError(e.message));
  }, [cola, slug]);
  useEffect(() => {
    if (!cola || !fecha) return;
    setSlots(null); setSlot(null);
    api<Slot[]>(`/api/v1/public/locales/${slug}/slots?colaId=${cola}&fecha=${fecha}`).then(setSlots).catch((e) => setError(e.message));
  }, [cola, fecha, slug]);

  async function reservar() {
    if (!cola || !slot) return;
    setEnviando(true); setError(null);
    try {
      setCita(await api<Cita>("/api/v1/public/citas", { method: "POST", headers: { "Idempotency-Key": `${clave}-${slot.id}` }, json: { slug, colaId: cola, slotId: slot.id, nombre: datos.nombre, telefono: datos.telefono || null, consentimiento: datos.consentimiento } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reservar");
      if (fecha) api<Slot[]>(`/api/v1/public/locales/${slug}/slots?colaId=${cola}&fecha=${fecha}`).then(setSlots).catch(() => {});
    } finally {
      setEnviando(false);
    }
  }

  const color = info?.local?.color ?? "#0f766e";
  const fmtDia = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const cabecera = <CabeceraLocal local={{ nombreComercial: info?.local?.nombre ?? "Reservar una cita", direccion: null, colorPrimario: color, logoUrl: null }} sobretitulo={cita ? "Cita reservada" : "Reservar una cita"} />;

  if (cita) {
    return (
      <div className="flex min-h-dvh flex-col bg-muted/40">
        {cabecera}
        <main className="relative mx-auto -mt-6 w-full max-w-md px-4 pb-10">
          <div className="flex animate-enter-soft flex-col items-center gap-4 rounded-3xl bg-card p-6 text-center shadow-float ring-1 ring-foreground/5">
            <CheckAnimado />
            <h1 className="text-2xl font-semibold tracking-tight">Cita reservada</h1>
            <p className="text-lg">{cita.cola.nombre}<br /><b className="capitalize">{cita.inicioLocal}</b></p>
            <div className="animate-pop rounded-2xl bg-white p-3 shadow-soft ring-1 ring-border [animation-delay:200ms]">
              <QRCodeSVG value={cita.urlQr} size={180} />
            </div>
            <p>Código de check-in: <b className="font-mono text-xl tracking-wider">{cita.codigoCheckin}</b></p>
            <p className="text-sm text-muted-foreground">Al llegar, escanea el QR en el kiosco o abre tu cita y escribe el PIN que aparece en la pantalla del local.</p>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1" style={{ background: color }}><Link href={`/c/${cita.token}`}>Ver mi cita</Link></Button>
              <Button asChild variant="outline" className="flex-1"><a href={`/api/v1/public/citas/${cita.token}/ics`}><CalendarPlus className="size-4" /> Agregar al calendario</a></Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      {cabecera}
      <main className="relative mx-auto -mt-6 w-full max-w-lg space-y-4 px-4 pb-10">
        {!info && !error && (
          <div className="space-y-3 rounded-3xl bg-card p-5 shadow-float" aria-busy="true">
            <div className="skeleton h-6 w-1/3 rounded-lg" />
            <div className="skeleton h-14 rounded-xl" />
            <div className="skeleton h-14 rounded-xl opacity-70" />
          </div>
        )}
        {info && !info.disponible && <p className="animate-enter rounded-3xl bg-card p-5 shadow-float">Este local no atiende con cita por el momento. <Link href={`/l/${slug}`} className="font-medium underline">Toma un turno</Link>.</p>}
        {error && <p role="alert" className="animate-shake rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {info?.disponible && (
          <div className="animate-enter-soft space-y-7 rounded-3xl bg-card p-5 shadow-float ring-1 ring-foreground/5">
            <section aria-label="Servicio" className="space-y-3">
              <Paso n={1} titulo="Servicio" hecho={!!cola} color={color} />
              <div className="grid grid-cols-1 gap-2">
                {info.colas.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCola(c.id)}
                    aria-pressed={cola === c.id}
                    style={{ ["--i" as string]: i, ...(cola === c.id ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : {}) }}
                    className="press min-h-12 animate-enter stagger rounded-xl border bg-background p-3 text-left hover:border-foreground/20"
                  >
                    <span className="font-medium">{c.nombre}</span>
                    {c.descripcion && <span className="block text-sm text-muted-foreground">{c.descripcion}</span>}
                  </button>
                ))}
              </div>
            </section>

            {cola && (
              <section aria-label="Día" className="animate-enter space-y-3">
                <Paso n={2} titulo="Día" hecho={!!fecha} color={color} />
                <div className="-mx-5 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
                  {dias.length === 0 && [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-16 min-w-20 rounded-xl" />)}
                  {dias.map((d, i) => {
                    const sel = fecha === d.fecha;
                    return (
                      <button
                        key={d.fecha}
                        type="button"
                        disabled={!d.abierto || !d.libres}
                        onClick={() => setFecha(d.fecha)}
                        aria-pressed={sel}
                        style={{ ["--i" as string]: i, ...(sel ? { background: color, borderColor: color } : {}) }}
                        className={cn("press min-h-16 min-w-20 shrink-0 snap-start animate-pop stagger rounded-xl border bg-background p-2 text-sm capitalize disabled:opacity-40", sel && "font-semibold text-white")}
                      >
                        {fmtDia(d.fecha)}
                        <span className={cn("block text-xs normal-case", sel ? "text-white/80" : "text-muted-foreground")}>{d.abierto ? `${d.libres} cupos` : "cerrado"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {fecha && (
              <section aria-label="Horario" className="animate-enter space-y-3">
                <Paso n={3} titulo="Horario" hecho={!!slot} color={color} />
                {!slots ? (
                  <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skeleton h-11 rounded-lg" />)}</div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay horarios ese día.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {slots.map((s, i) => {
                      const sel = slot?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={!s.disponible}
                          onClick={() => setSlot(s)}
                          aria-pressed={sel}
                          style={{ ["--i" as string]: Math.min(i, 12), ...(sel ? { background: color, borderColor: color } : {}) }}
                          className={cn("press min-h-11 animate-pop stagger rounded-lg border bg-background text-sm tabular-nums disabled:line-through disabled:opacity-40", sel && "font-semibold text-white")}
                        >
                          {s.hora}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {slot && (
              <section aria-label="Tus datos" className="animate-enter space-y-3">
                <Paso n={4} titulo="Tus datos" hecho={datos.nombre.trim().length >= 2} color={color} />
                <div className="space-y-1.5"><Label htmlFor="nom">Nombre</Label><Input id="nom" required maxLength={60} className="h-12 text-base" value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="tel">Celular (opcional, para recordatorios)</Label><Input id="tel" inputMode="tel" maxLength={12} placeholder="951234567" className="h-12 text-base" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} /></div>
                {datos.telefono && (
                  <label className="flex animate-enter cursor-pointer gap-3 rounded-2xl border p-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" style={{ accentColor: color }} checked={datos.consentimiento} onChange={(e) => setDatos({ ...datos, consentimiento: e.target.checked })} /> Acepto que usen mi celular solo para recordarme la cita (Ley 29733). Se borra a los 90 días.</label>
                )}
                <Button size="xl" className="w-full" style={{ background: color }} disabled={enviando || datos.nombre.trim().length < 2 || (!!datos.telefono && !datos.consentimiento)} onClick={reservar}>
                  {enviando ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />} {enviando ? "Reservando…" : `Reservar ${slot.hora}`}
                </Button>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
