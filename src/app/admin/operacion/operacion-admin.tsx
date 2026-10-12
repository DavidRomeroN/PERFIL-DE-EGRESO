"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/fetcher";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function OperacionAdmin(props: {
  categorias: { codigo: string; nombre: string; pesoBase: number }[];
  config: { alfa: number; tope: number; ausenciaSeg: number };
  horarios: { diaSemana: number; apertura: string; cierre: string; activo: boolean }[];
  colas: { id: number; nombre: string }[];
  espera: { id: number; codigo: string; cola: string }[];
}) {
  const router = useRouter();
  const [pesos, setPesos] = useState(Object.fromEntries(props.categorias.map((c) => [c.codigo, c.pesoBase])));
  const [cfg, setCfg] = useState(props.config);
  const [turnoId, setTurnoId] = useState(props.espera[0]?.id ?? 0);
  const [colaDestino, setColaDestino] = useState(props.colas[0]?.id ?? 0);
  const [cita, setCita] = useState({ colaId: props.colas[0]?.id ?? 0, inicio: "", nombre: "" });

  async function post(json: object) {
    await api("/api/v1/operacion", { method: "POST", json });
    toast.success("Guardado");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Prioridades, horario y citas</h1>
        <p className="text-sm text-muted-foreground">La pantalla y el WhatsApp siguen mostrando solo el número de turno. La categoría la ve el personal.</p>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Peso de las categorías</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {props.categorias.map((c) => (
            <label key={c.codigo} className="flex items-center justify-between gap-3 text-sm">
              {c.nombre}
              <Input className="w-24" type="number" value={pesos[c.codigo] ?? 0} onChange={(e) => setPesos({ ...pesos, [c.codigo]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <Button className="mt-4" onClick={async () => {
          for (const c of props.categorias) await post({ accion: "prioridad", codigo: c.codigo, pesoBase: pesos[c.codigo] ?? c.pesoBase });
        }}>Guardar pesos</Button>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Tope de adelantos y ausencia</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div><Label>Alfa (puntos/min)</Label><Input type="number" step="0.1" value={cfg.alfa} onChange={(e) => setCfg({ ...cfg, alfa: Number(e.target.value) })} /></div>
          <div><Label>Tope de preferentes seguidos</Label><Input type="number" value={cfg.tope} onChange={(e) => setCfg({ ...cfg, tope: Number(e.target.value) })} /></div>
          <div><Label>Segundos para no presentado</Label><Input type="number" value={cfg.ausenciaSeg} onChange={(e) => setCfg({ ...cfg, ausenciaSeg: Number(e.target.value) })} /></div>
        </div>
        <Button className="mt-4" onClick={() => post({ accion: "config", alfa: cfg.alfa, tope: cfg.tope, ausenciaSeg: cfg.ausenciaSeg })}>Guardar reglas</Button>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Horario de atención</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {props.horarios.map((h) => (
            <li key={h.diaSemana} className="flex flex-wrap items-center gap-2">
              <span className="w-28">{DIAS[h.diaSemana]}</span>
              <span>{h.activo ? `${h.apertura} – ${h.cierre}` : "Cerrado"}</span>
              <Button size="sm" variant="outline" onClick={() => post({ accion: "horario", ...h, activo: !h.activo })}>{h.activo ? "Cerrar día" : "Abrir día"}</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Transferir un turno en espera</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="h-10 rounded-lg border px-2" value={turnoId} onChange={(e) => setTurnoId(Number(e.target.value))}>
            {props.espera.map((t) => <option key={t.id} value={t.id}>{t.codigo} · {t.cola}</option>)}
          </select>
          <select className="h-10 rounded-lg border px-2" value={colaDestino} onChange={(e) => setColaDestino(Number(e.target.value))}>
            {props.colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <Button onClick={() => post({ accion: "transferir", turnoId, colaDestinoId: colaDestino })}>Transferir</Button>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Reservar cita</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <select className="h-10 rounded-lg border px-2" value={cita.colaId} onChange={(e) => setCita({ ...cita, colaId: Number(e.target.value) })}>
            {props.colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <Input type="datetime-local" value={cita.inicio} onChange={(e) => setCita({ ...cita, inicio: e.target.value })} />
          <Input placeholder="Nombre" value={cita.nombre} onChange={(e) => setCita({ ...cita, nombre: e.target.value })} />
        </div>
        <Button className="mt-3" onClick={async () => {
          const r = await api<{ token: string }>("/api/v1/operacion", { method: "PUT", json: { accion: "cita", localId: 0, colaId: cita.colaId, inicioISO: new Date(cita.inicio).toISOString(), nombre: cita.nombre } });
          toast.success(`Cita lista. Check-in: /cita/${r.token}`);
        }}>Crear cita</Button>
      </section>
    </div>
  );
}
