"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Seccion, accion, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
interface Datos {
  horarios: { diaSemana: number; apertura: string; cierre: string; activo: boolean }[];
  tiempoAusenciaSeg: number | null;
  estado: { abierto: boolean; mensaje: string | null };
}

/** N05 horario del local y N04 expiración automática de llamados (opt-in). */
export function OperacionAdmin() {
  const { datos, error, cargando, recargar } = useDatos<Datos>("/api/v1/operacion");
  const [dias, setDias] = useState(DIAS.map((_, d) => ({ diaSemana: d, apertura: "08:00", cierre: "18:00", activo: false })));
  const [ausencia, setAusencia] = useState<number | null>(null);

  useEffect(() => {
    if (!datos) return;
    setDias(DIAS.map((_, d) => datos.horarios.find((h) => h.diaSemana === d) ?? { diaSemana: d, apertura: "08:00", cierre: "18:00", activo: false }));
    setAusencia(datos.tiempoAusenciaSeg);
  }, [datos]);

  return (
    <div className="space-y-6">
      <PageHeader title="Horario y ausencias" description={datos ? (datos.estado.abierto ? "Ahora el local está abierto." : datos.estado.mensaje ?? "Cerrado") : undefined} />
      <Estado cargando={cargando} error={error}>
        <Seccion titulo="Horario de atención" descripcion="Sin ningún día configurado, el local se considera siempre abierto." acciones={
          <Button onClick={async () => {
            for (const d of dias) {
              const existe = datos?.horarios.some((h) => h.diaSemana === d.diaSemana);
              if (d.activo || existe) await api("/api/v1/operacion", { method: "POST", json: { accion: "horario", ...d } });
            }
            const { toast } = await import("sonner");
            toast.success("Horario guardado");
            void recargar();
          }}>Guardar horario</Button>
        }>
          <div className="space-y-2">
            {dias.map((d, i) => (
              <div key={d.diaSemana} className="flex flex-wrap items-center gap-3 rounded-xl border p-2">
                <label className="flex w-36 items-center gap-2 text-sm"><Switch checked={d.activo} onCheckedChange={(v) => setDias(dias.map((x, j) => (j === i ? { ...x, activo: v } : x)))} /> {DIAS[d.diaSemana]}</label>
                <Input type="time" aria-label={`Apertura ${DIAS[d.diaSemana]}`} className="w-32" value={d.apertura} disabled={!d.activo} onChange={(e) => setDias(dias.map((x, j) => (j === i ? { ...x, apertura: e.target.value } : x)))} />
                <span className="text-sm text-muted-foreground">a</span>
                <Input type="time" aria-label={`Cierre ${DIAS[d.diaSemana]}`} className="w-32" value={d.cierre} disabled={!d.activo} onChange={(e) => setDias(dias.map((x, j) => (j === i ? { ...x, cierre: e.target.value } : x)))} />
              </div>
            ))}
          </div>
        </Seccion>
        <Seccion titulo="Expiración automática de llamados (RN04)" descripcion="Si un turno llamado no se presenta en este tiempo pasa a “No se presentó” y se avisa al cliente. Es opcional.">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm"><Switch checked={ausencia !== null} onCheckedChange={(v) => setAusencia(v ? 180 : null)} /> Activada</label>
            <div>
              <Label htmlFor="aus">Segundos</Label>
              <Input id="aus" type="number" min={30} max={900} className="w-28" disabled={ausencia === null} value={ausencia ?? ""} onChange={(e) => setAusencia(Number(e.target.value))} />
            </div>
            <Button variant="outline" onClick={async () => { if (await accion(() => api("/api/v1/operacion", { method: "POST", json: { accion: "ausencia", ausenciaSeg: ausencia } }), "Guardado")) void recargar(); }}>Guardar</Button>
          </div>
        </Seccion>
      </Estado>
    </div>
  );
}
