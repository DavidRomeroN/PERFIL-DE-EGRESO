"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/fetcher";

export default function Page() {
  const [f, setF] = useState({ llegadasPorHora: 40, servicioMin: 6, servidores: 5 });
  const [r, setR] = useState<{ estable: boolean; probabilidadEspera: number; esperaMin: number; ocupacion: number } | null>(null);
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Simulador de ventanillas</h1>
      <p className="text-sm text-muted-foreground">Erlang C: cuántas ventanillas necesitas para una espera objetivo.</p>
      <div className="grid gap-3">
        <div><Label>Llegadas por hora</Label><Input type="number" value={f.llegadasPorHora} onChange={(e) => setF({ ...f, llegadasPorHora: Number(e.target.value) })} /></div>
        <div><Label>Minutos por atención</Label><Input type="number" value={f.servicioMin} onChange={(e) => setF({ ...f, servicioMin: Number(e.target.value) })} /></div>
        <div><Label>Ventanillas</Label><Input type="number" value={f.servidores} onChange={(e) => setF({ ...f, servidores: Number(e.target.value) })} /></div>
      </div>
      <Button onClick={async () => setR(await api("/api/v1/operacion", { method: "PUT", json: { accion: "simular", ...f } }))}>Calcular</Button>
      {r && (
        <div className="rounded-2xl border bg-card p-4 text-sm">
          <p>Ocupación: {Math.round(r.ocupacion * 100)}%</p>
          <p>Probabilidad de esperar: {Math.round(r.probabilidadEspera * 100)}%</p>
          <p>Espera media: {r.estable ? `${r.esperaMin.toFixed(1)} min` : "la cola crece sin límite"}</p>
        </div>
      )}
    </div>
  );
}
