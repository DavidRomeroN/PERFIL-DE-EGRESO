"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { accion } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Modulo {
  codigo: string;
  nombre: string;
  descripcion: string;
  ruta: string;
  integrante: string;
  incluido: boolean;
  habilitado: boolean;
}

/** N03 · Hub de módulos: qué incluye el plan y el interruptor de cada módulo en este local. */
export function HubModulos({ inicial, plan }: { inicial: Modulo[]; plan: string }) {
  const [mods, setMods] = useState(inicial);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const router = useRouter();

  async function cambiar(m: Modulo, habilitado: boolean) {
    setOcupado(m.codigo);
    const r = await accion(() => api<Modulo[]>(`/api/v1/modulos/${m.codigo}`, { method: "PUT", json: { habilitado } }), habilitado ? `${m.nombre} activado` : `${m.nombre} desactivado`);
    if (r) {
      setMods(r);
      router.refresh();
    }
    setOcupado(null);
  }

  return (
    <div>
      <PageHeader title="Módulos" description={`Plan ${plan}. Un módulo apagado deja el sistema exactamente como el núcleo original.`} />
      <ul className="grid gap-4 md:grid-cols-2">
        {mods.map((m) => (
          <li key={m.codigo} className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{m.codigo} · {m.integrante}</p>
                <p className="mt-0.5 text-lg font-semibold">{m.nombre}</p>
              </div>
              {m.incluido ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Activar {m.nombre}</span>
                  <Switch checked={m.habilitado} disabled={ocupado === m.codigo} onCheckedChange={(v) => void cambiar(m, v)} />
                </label>
              ) : (
                <Badge variant="outline" className="gap-1"><Lock className="size-3" /> No incluido</Badge>
              )}
            </div>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{m.descripcion}</p>
            <div className="mt-4 flex items-center justify-between">
              <Badge className={m.habilitado ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}>{m.habilitado ? "Activo" : m.incluido ? "Apagado" : "Requiere otro plan"}</Badge>
              {m.habilitado && <Link href={m.ruta} className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">Configurar <ArrowRight className="size-3.5" /></Link>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
