"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Modal, Seccion, Tabla, accion, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

const MODULOS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"] as const;
const NOMBRES: Record<string, string> = { M1: "Prioridades", M2: "Predicción", M3: "Citas", M4: "Chatbot", M5: "Kiosco", M6: "Balanceo", M7: "Analítica", M8: "Simulador" };

interface Plan {
  id: number;
  codigo: string;
  nombre: string;
  precioMensual: string;
  maxTurnosMes: number;
  maxColas: number;
  maxVentanillas: number;
  whatsappHabilitado: boolean;
  maxAvisosWhatsapp: number;
  reportes: boolean;
  descripcion: string | null;
  modulos: { modulo: string }[];
  _count: { locales: number };
}

const VACIO = { codigo: "", nombre: "", precioMensual: 0, maxTurnosMes: 1000, maxColas: 1, maxVentanillas: 1, whatsappHabilitado: false, maxAvisosWhatsapp: 0, reportes: false, descripcion: "", modulos: [] as string[] };

/** N08 · Planes y matriz plan × módulo (solo super-admin). */
export function Planes() {
  const { datos, error, cargando, recargar } = useDatos<Plan[]>("/api/v1/planes");
  const [edit, setEdit] = useState<(typeof VACIO & { id?: number }) | null>(null);

  async function cambiarModulo(p: Plan, m: string, on: boolean) {
    const modulos = on ? [...p.modulos.map((x) => x.modulo), m] : p.modulos.map((x) => x.modulo).filter((x) => x !== m);
    if (await accion(() => api(`/api/v1/planes/${p.id}`, { method: "PATCH", json: { modulos } }), "Plan actualizado")) void recargar();
  }

  async function guardar() {
    if (!edit) return;
    const { id, ...json } = edit;
    const r = await accion(() => api(id ? `/api/v1/planes/${id}` : "/api/v1/planes", { method: id ? "PATCH" : "POST", json: { ...json, descripcion: json.descripcion || null } }), "Plan guardado");
    if (r) {
      setEdit(null);
      void recargar();
    }
  }

  const num = (k: keyof typeof VACIO, etiqueta: string) => (
    <div><Label htmlFor={k} className="text-xs">{etiqueta}</Label><Input id={k} type="number" min={0} value={Number(edit?.[k] ?? 0)} onChange={(e) => edit && setEdit({ ...edit, [k]: Number(e.target.value) })} /></div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Planes y módulos" description="Límites de cada plan y qué módulos incluye. Cambiar la matriz afecta a todos los locales del plan.">
        <Button onClick={() => setEdit({ ...VACIO })}><Plus className="size-4" /> Nuevo plan</Button>
      </PageHeader>
      <Estado cargando={cargando} error={error}>
        <Seccion titulo="Matriz plan × módulo">
          <Tabla
            columnas={["Plan", ...MODULOS.map((m) => `${m} ${NOMBRES[m]}`)]}
            filas={(datos ?? []).map((p) => [
              <b key="n">{p.nombre}</b>,
              ...MODULOS.map((m) => <Switch key={m} aria-label={`${m} en ${p.nombre}`} checked={p.modulos.some((x) => x.modulo === m)} onCheckedChange={(v) => void cambiarModulo(p, m, v)} />),
            ])}
          />
        </Seccion>
        <Seccion titulo="Límites">
          <Tabla
            columnas={["Plan", "Precio", "Turnos/mes", "Colas", "Ventanillas", "WhatsApp", "Locales", ""]}
            filas={(datos ?? []).map((p) => [
              <span key="n"><b>{p.nombre}</b><span className="block text-xs text-muted-foreground">{p.codigo}</span></span>,
              `S/ ${Number(p.precioMensual).toFixed(0)}`,
              p.maxTurnosMes.toLocaleString("es-PE"),
              p.maxColas,
              p.maxVentanillas,
              p.whatsappHabilitado ? `${p.maxAvisosWhatsapp} avisos` : "No",
              p._count.locales,
              <div key="a" className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => setEdit({ id: p.id, codigo: p.codigo, nombre: p.nombre, precioMensual: Number(p.precioMensual), maxTurnosMes: p.maxTurnosMes, maxColas: p.maxColas, maxVentanillas: p.maxVentanillas, whatsappHabilitado: p.whatsappHabilitado, maxAvisosWhatsapp: p.maxAvisosWhatsapp, reportes: p.reportes, descripcion: p.descripcion ?? "", modulos: p.modulos.map((x) => x.modulo) })}>Editar</Button>
                {p._count.locales === 0 && <Button size="xs" variant="ghost" className="text-rose-700" onClick={async () => { if (await accion(() => api(`/api/v1/planes/${p.id}`, { method: "DELETE" }), "Plan eliminado")) void recargar(); }}>Eliminar</Button>}
              </div>,
            ])}
          />
        </Seccion>
      </Estado>
      <Modal abierto={!!edit} titulo={edit?.id ? "Editar plan" : "Nuevo plan"} onCerrar={() => setEdit(null)}>
        {edit && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="cod" className="text-xs">Código</Label><Input id="cod" value={edit.codigo} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, codigo: e.target.value.toUpperCase() })} /></div>
              <div><Label htmlFor="nom" className="text-xs">Nombre</Label><Input id="nom" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {num("precioMensual", "Precio (S/)")}
              {num("maxTurnosMes", "Turnos/mes")}
              {num("maxAvisosWhatsapp", "Avisos WhatsApp")}
              {num("maxColas", "Colas")}
              {num("maxVentanillas", "Ventanillas")}
            </div>
            <label className="flex items-center justify-between text-sm">WhatsApp habilitado <Switch checked={edit.whatsappHabilitado} onCheckedChange={(v) => setEdit({ ...edit, whatsappHabilitado: v })} /></label>
            <label className="flex items-center justify-between text-sm">Reportes <Switch checked={edit.reportes} onCheckedChange={(v) => setEdit({ ...edit, reportes: v })} /></label>
            <Input aria-label="Descripción" placeholder="Descripción" value={edit.descripcion} onChange={(e) => setEdit({ ...edit, descripcion: e.target.value })} />
            <Button onClick={guardar}>Guardar</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
