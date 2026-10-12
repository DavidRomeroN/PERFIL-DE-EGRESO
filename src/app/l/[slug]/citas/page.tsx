"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/fetcher";

interface Info { disponible: boolean; local?: { nombre: string; color: string }; colas: { id: number; nombre: string; descripcion: string | null }[] }
interface Dia { fecha: string; abierto: boolean; libres: number }
interface Slot { id: number; hora: string; restantes: number; disponible: boolean }
interface Cita { token: string; codigoCheckin: string; inicioLocal: string; cola: { nombre: string }; urlQr: string }

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

  if (cita) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">¡Cita reservada!</h1>
        <p className="text-lg">{cita.cola.nombre}<br /><b className="capitalize">{cita.inicioLocal}</b></p>
        <QRCodeSVG value={cita.urlQr} size={200} />
        <p>Código de check-in: <b className="font-mono text-xl">{cita.codigoCheckin}</b></p>
        <p className="text-sm text-muted-foreground">Al llegar, escanea el QR en el kiosco o abre tu cita y escribe el PIN que aparece en la pantalla del local.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild style={{ background: color }}><Link href={`/c/${cita.token}`}>Ver mi cita</Link></Button>
          <Button asChild variant="outline"><a href={`/api/v1/public/citas/${cita.token}/ics`}>Agregar al calendario</a></Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-6 p-5">
      <header>
        <p className="text-sm text-muted-foreground">{info?.local?.nombre}</p>
        <h1 className="text-2xl font-bold">Reservar una cita</h1>
      </header>
      {info && !info.disponible && <p className="rounded-xl border p-4">Este local no atiende con cita por el momento. <Link href={`/l/${slug}`} className="underline">Toma un turno</Link>.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {info?.disponible && (
        <>
          <section aria-label="Servicio" className="space-y-2">
            <h2 className="font-semibold">1. Servicio</h2>
            <div className="grid gap-2">
              {info.colas.map((c) => (
                <button key={c.id} type="button" onClick={() => setCola(c.id)} aria-pressed={cola === c.id} className={`min-h-12 rounded-xl border p-3 text-left ${cola === c.id ? "border-2 font-semibold" : ""}`} style={cola === c.id ? { borderColor: color } : undefined}>{c.nombre}{c.descripcion && <span className="block text-sm font-normal text-muted-foreground">{c.descripcion}</span>}</button>
              ))}
            </div>
          </section>

          {cola && (
            <section aria-label="Día" className="space-y-2">
              <h2 className="font-semibold">2. Día</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {dias.map((d) => (
                  <button key={d.fecha} type="button" disabled={!d.abierto || !d.libres} onClick={() => setFecha(d.fecha)} aria-pressed={fecha === d.fecha} className={`min-h-16 min-w-20 rounded-xl border p-2 text-sm capitalize disabled:opacity-40 ${fecha === d.fecha ? "border-2 font-semibold" : ""}`} style={fecha === d.fecha ? { borderColor: color } : undefined}>
                    {fmtDia(d.fecha)}<span className="block text-xs text-muted-foreground">{d.abierto ? `${d.libres} cupos` : "cerrado"}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {fecha && (
            <section aria-label="Horario" className="space-y-2">
              <h2 className="font-semibold">3. Horario</h2>
              {!slots ? <p className="text-sm text-muted-foreground">Cargando…</p> : slots.length === 0 ? <p className="text-sm text-muted-foreground">No hay horarios ese día.</p> : (
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((s) => (
                    <button key={s.id} type="button" disabled={!s.disponible} onClick={() => setSlot(s)} aria-pressed={slot?.id === s.id} className={`min-h-11 rounded-lg border text-sm disabled:line-through disabled:opacity-40 ${slot?.id === s.id ? "text-white" : ""}`} style={slot?.id === s.id ? { background: color } : undefined}>{s.hora}</button>
                  ))}
                </div>
              )}
            </section>
          )}

          {slot && (
            <section aria-label="Tus datos" className="space-y-3">
              <h2 className="font-semibold">4. Tus datos</h2>
              <div><Label htmlFor="nom">Nombre</Label><Input id="nom" required maxLength={60} value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} /></div>
              <div><Label htmlFor="tel">Celular (opcional, para recordatorios)</Label><Input id="tel" inputMode="tel" maxLength={12} placeholder="951234567" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} /></div>
              {datos.telefono && (
                <label className="flex gap-2 text-sm"><input type="checkbox" checked={datos.consentimiento} onChange={(e) => setDatos({ ...datos, consentimiento: e.target.checked })} /> Acepto que usen mi celular solo para recordarme la cita (Ley 29733). Se borra a los 90 días.</label>
              )}
              <Button className="h-12 w-full text-base" style={{ background: color }} disabled={enviando || datos.nombre.trim().length < 2 || (!!datos.telefono && !datos.consentimiento)} onClick={reservar}>{enviando ? "Reservando…" : `Reservar ${slot.hora}`}</Button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
