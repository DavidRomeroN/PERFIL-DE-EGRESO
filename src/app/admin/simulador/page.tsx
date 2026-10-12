"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { erlangC } from "@/lib/capacidad/erlang";
import { simularCola } from "@/lib/capacidad/des";

export default function Page() {
  const [f, setF] = useState({ llegadasPorHora: 40, servicioMin: 6, servidores: 5 });
  const [r, setR] = useState<{ estable: boolean; probabilidadEspera: number; esperaMin: number | null; ocupacion: number } | null>(null);
  const [des, setDes] = useState<{ esperaMediaMin: number; esperaP90Min: number; abandono: number; atendidos: number } | null>(null);
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Simulador de ventanillas</h1>
      <p className="text-sm text-muted-foreground">Erlang C: cuántas ventanillas necesitas para una espera objetivo.</p>
      <div className="grid gap-3">
        <div><Label>Llegadas por hora</Label><Input type="number" value={f.llegadasPorHora} onChange={(e) => setF({ ...f, llegadasPorHora: Number(e.target.value) })} /></div>
        <div><Label>Minutos por atención</Label><Input type="number" value={f.servicioMin} onChange={(e) => setF({ ...f, servicioMin: Number(e.target.value) })} /></div>
        <div><Label>Ventanillas</Label><Input type="number" value={f.servidores} onChange={(e) => setF({ ...f, servidores: Number(e.target.value) })} /></div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => setR(erlangC(f.llegadasPorHora, f.servicioMin, f.servidores))}>Erlang C</Button>
        <Button variant="outline" onClick={() => setDes(simularCola({ ...f, horas: 4, replicas: 20, semilla: 7 }))}>Simular 4 horas</Button>
        <Button variant="outline" onClick={() => localStorage.setItem("turnoya-escenario", JSON.stringify(f))}>Guardar escenario</Button>
        <Button variant="outline" onClick={() => {
          const g = localStorage.getItem("turnoya-escenario");
          if (g) setF(JSON.parse(g) as typeof f);
        }}>Cargar escenario</Button>
      </div>
      {r && (
        <div className="rounded-2xl border bg-card p-4 text-sm">
          <p>Ocupación: {Math.round(r.ocupacion * 100)}%</p>
          <p>Probabilidad de esperar: {Math.round(r.probabilidadEspera * 100)}%</p>
          <p>Espera media: {r.estable && r.esperaMin != null ? `${r.esperaMin.toFixed(1)} min` : "la cola crece sin límite"}</p>
        </div>
      )}
      {des && (
        <div className="rounded-2xl border bg-card p-4 text-sm">
          <p>Simulación: espera media {des.esperaMediaMin.toFixed(1)} min · percentil 90 {des.esperaP90Min.toFixed(1)} min</p>
          <p>Atendidos {des.atendidos} · abandonos {des.abandono}</p>
        </div>
      )}
    </div>
  );
}
