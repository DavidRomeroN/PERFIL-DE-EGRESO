"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/fetcher";
import { toast } from "sonner";

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [colas, setColas] = useState<{ id: number; nombre: string }[]>([]);
  const [colaId, setColaId] = useState(0);
  const [slots, setSlots] = useState<{ inicio: string; libres: number }[]>([]);
  const [inicio, setInicio] = useState("");
  const [nombre, setNombre] = useState("");
  const [reserva, setReserva] = useState<{ token: string; pin: string } | null>(null);
  const [mejores, setMejores] = useState<{ hora: number; esperaMin: number }[]>([]);

  useEffect(() => {
    api<{ colas: { id: number; nombre: string }[] }>(`/api/v1/public/locales/${slug}`).then((d) => {
      setColas(d.colas);
      setColaId(d.colas[0]?.id ?? 0);
    }).catch(() => toast.error("No se pudo cargar el local"));
  }, [slug]);

  useEffect(() => {
    if (!colaId) return;
    api<{ inicio: string; libres: number }[]>(`/api/v1/public/locales/${slug}/citas?colaId=${colaId}`)
      .then(setSlots)
      .catch(() => setSlots([]));
    api<{ hora: number; esperaMin: number }[]>(`/api/v1/public/colas/${colaId}/mejores-horas`).then(setMejores).catch(() => setMejores([]));
  }, [slug, colaId]);

  const dias = [...new Set(slots.map((s) => s.inicio.slice(0, 10)))];
  const [dia, setDia] = useState("");
  const delDia = slots.filter((s) => s.inicio.slice(0, 10) === (dia || dias[0]));

  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-10">
      <h1 className="text-2xl font-semibold">Reservar cita</h1>
      <p className="text-sm text-muted-foreground">Elige un horario de los próximos 14 días. Cada franja admite 3 personas.</p>
      {mejores.length > 0 && <p className="text-sm">Horas con menos espera: {mejores.map((m) => `${m.hora}:00 (~${m.esperaMin} min)`).join(" · ")}</p>}
      <select className="h-11 w-full rounded-xl border px-3" value={colaId} onChange={(e) => setColaId(Number(e.target.value))}>
        {colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <div className="flex gap-2 overflow-x-auto">
        {dias.map((d) => (
          <button key={d} type="button" onClick={() => setDia(d)} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${d === (dia || dias[0]) ? "bg-foreground text-background" : ""}`}>{d.slice(5)}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {delDia.map((s) => (
          <button key={s.inicio} type="button" onClick={() => setInicio(s.inicio)} className={`rounded-xl border px-2 py-2 text-sm ${inicio === s.inicio ? "border-foreground" : ""}`}>
            {new Date(s.inicio).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
            <span className="block text-[10px] text-muted-foreground">{s.libres} libres</span>
          </button>
        ))}
      </div>
      {delDia.length === 0 && <p className="text-sm text-muted-foreground">No hay horarios libres. Revisa que el local tenga horario de atención.</p>}
      <Input placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Button disabled={!inicio || nombre.trim().length < 2} onClick={async () => {
        try {
          const r = await api<{ token: string }>("/api/v1/public/citas", { method: "POST", json: { slug, colaId, inicioISO: inicio, nombre, consentimiento: true } });
          setReserva({ token: r.token, pin: r.token.slice(-4).toUpperCase() });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo reservar");
        }
      }}>Reservar</Button>
      {reserva && (
        <div className="rounded-2xl border p-4 text-sm">
          <p>PIN de llegada: <strong className="font-mono text-lg">{reserva.pin}</strong></p>
          <p className="mt-2"><a className="underline" href={`/cita/${reserva.token}`}>Hacer check-in</a></p>
          <p><a className="underline" href={`/api/v1/public/citas/${reserva.token}/ics`}>Agregar al calendario</a></p>
        </div>
      )}
    </main>
  );
}
