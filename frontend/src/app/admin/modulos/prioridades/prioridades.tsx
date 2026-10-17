"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Modal, Seccion, Tabla, accion, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Categoria {
  id: number;
  codigo: string;
  nombre: string;
  pesoBase: number;
  absoluta: boolean;
  documento: string;
  esperaMaxSeg: number | null;
  visibleCliente: boolean;
  activa: boolean;
  orden: number;
}
interface Datos {
  config: { alfa: number; tope: number; aging: boolean };
  categorias: Categoria[];
}
interface Vista {
  fifo: string[];
  priorizado: string[];
  puntajes: Record<string, number>;
}

const DOCS = ["NINGUNO", "DNI", "CARNE_GESTANTE", "CONADIS", "TRIAJE"];
const EJEMPLO = [
  { codigo: "A-030", categoria: "GENERAL", esperaMin: 38 },
  { codigo: "A-031", categoria: "DISCAPACIDAD", esperaMin: 21 },
  { codigo: "A-032", categoria: "GENERAL", esperaMin: 15 },
  { codigo: "A-033", categoria: "GESTANTE", esperaMin: 9 },
  { codigo: "A-034", categoria: "ADULTO_MAYOR", esperaMin: 3 },
];

/** M1 · Reglas de prioridad: α, tope, aging, categorías y vista previa antes de guardar (RF-M1-01…09). */
export function Prioridades() {
  const { datos, error, cargando, recargar } = useDatos<Datos>("/api/v1/prioridades");
  const [cfg, setCfg] = useState({ alfa: 1.5, tope: 3, aging: true });
  const [pesos, setPesos] = useState<Record<string, number>>({});
  const [vista, setVista] = useState<Vista | null>(null);
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState({ codigo: "", nombre: "", pesoBase: 40, documento: "NINGUNO", visibleCliente: true });

  useEffect(() => {
    if (!datos) return;
    setCfg(datos.config);
    setPesos(Object.fromEntries(datos.categorias.map((c) => [c.codigo, c.pesoBase])));
  }, [datos]);

  // Vista previa en vivo con los valores aún no guardados (RF-M1-09)
  useEffect(() => {
    if (!datos) return;
    const t = setTimeout(() => {
      api<Vista>("/api/v1/prioridades/simular", { method: "POST", json: { config: { alfaPuntosPorMin: cfg.alfa, topeAdelantos: cfg.tope, agingActivo: cfg.aging }, turnos: EJEMPLO, pesos } })
        .then(setVista)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [cfg, pesos, datos]);

  async function guardarConfig() {
    const r = await accion(() => api<{ recalculados: number }>("/api/v1/prioridades/config", { method: "PUT", json: { alfaPuntosPorMin: cfg.alfa, topeAdelantos: cfg.tope, agingActivo: cfg.aging } }));
    if (r) toast.success(`Guardado: ${r.recalculados} turnos en espera reordenados`);
  }

  async function guardarCategoria(c: Categoria, cambios: Partial<Categoria>) {
    if (await accion(() => api(`/api/v1/prioridades/categorias/${c.id}`, { method: "PATCH", json: cambios }), "Categoría actualizada")) void recargar();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prioridades"
        description="Atención preferente con antigüedad: los preferentes pasan delante, pero un general que esperó lo suficiente los alcanza y nunca hay más de N preferentes seguidos."
      />
      <Estado cargando={cargando} error={error}>
        {datos && (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Seccion titulo="Parámetros" descripcion="Se aplican a los turnos en espera de hoy al guardar." acciones={<Button onClick={guardarConfig}>Guardar</Button>}>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="alfa">α · puntos por minuto de espera: <b>{cfg.alfa.toFixed(1)}</b></Label>
                    <input id="alfa" type="range" min={0} max={10} step={0.1} value={cfg.alfa} onChange={(e) => setCfg({ ...cfg, alfa: Number(e.target.value) })} className="mt-2 w-full accent-teal-700" />
                    <p className="text-xs text-muted-foreground">
                      {cfg.alfa > 0 ? `Un general que lleva ${Math.round(60 / cfg.alfa)} min más que una gestante (peso 60) la alcanza.` : "Sin antigüedad: los preferentes siempre van primero."}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="tope">Tope de preferentes seguidos: <b>{cfg.tope === 0 ? "sin tope" : cfg.tope}</b></Label>
                    <input id="tope" type="range" min={0} max={10} step={1} value={cfg.tope} onChange={(e) => setCfg({ ...cfg, tope: Number(e.target.value) })} className="mt-2 w-full accent-teal-700" />
                  </div>
                  <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
                    Antigüedad (aging) activa
                    <Switch checked={cfg.aging} onCheckedChange={(v) => setCfg({ ...cfg, aging: v })} />
                  </label>
                </div>
              </Seccion>

              <Seccion titulo="Vista previa" descripcion="Cola de ejemplo con los valores actuales (sin guardar).">
                {vista ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="mb-2 font-medium text-muted-foreground">Orden de llegada (FIFO)</p>
                      <ol className="space-y-1">
                        {vista.fifo.map((c) => (
                          <li key={c} className="rounded-lg bg-muted px-2 py-1 font-mono">{c} · {EJEMPLO.find((e) => e.codigo === c)?.categoria.toLowerCase().replace("_", " ")}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="mb-2 font-medium text-teal-700">Con prioridades</p>
                      <ol className="space-y-1">
                        {vista.priorizado.map((c, i) => (
                          <li key={c} className="rounded-lg bg-teal-50 px-2 py-1 font-mono">{i + 1}. {c} · {Math.round(vista.puntajes[c])} pts</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Calculando…</p>
                )}
              </Seccion>
            </div>

            <Seccion
              titulo="Categorías"
              descripcion="La categoría es un dato sensible: nunca se muestra en la TV, el ticket ni WhatsApp."
              acciones={<Button variant="outline" onClick={() => setNueva(true)}><Plus className="size-4" /> Nueva</Button>}
            >
              <Tabla
                columnas={["Categoría", "Peso", "Documento", "El cliente la elige", "Activa", ""]}
                filas={datos.categorias.map((c) => [
                  <span key="n"><b>{c.nombre}</b><span className="block text-xs text-muted-foreground">{c.codigo}{c.absoluta ? " · salta la cola" : ""}</span></span>,
                  c.codigo === "GENERAL" ? "0" : (
                    <Input
                      key="p"
                      type="number"
                      min={0}
                      max={1000}
                      className="w-20"
                      aria-label={`Peso de ${c.nombre}`}
                      value={pesos[c.codigo] ?? c.pesoBase}
                      disabled={c.absoluta}
                      onChange={(e) => setPesos({ ...pesos, [c.codigo]: Number(e.target.value) })}
                      onBlur={() => pesos[c.codigo] !== c.pesoBase && void guardarCategoria(c, { pesoBase: pesos[c.codigo] })}
                    />
                  ),
                  c.documento === "NINGUNO" ? "—" : c.documento.replace("_", " "),
                  <Switch key="v" aria-label="Visible para el cliente" checked={c.visibleCliente} disabled={c.codigo === "CITA"} onCheckedChange={(v) => void guardarCategoria(c, { visibleCliente: v })} />,
                  <Switch key="a" aria-label="Activa" checked={c.activa} disabled={c.codigo === "GENERAL"} onCheckedChange={(v) => void guardarCategoria(c, { activa: v })} />,
                  c.codigo === "GENERAL" || c.codigo === "CITA" ? null : (
                    <Button
                      key="d"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Eliminar ${c.nombre}`}
                      onClick={async () => {
                        if (await accion(() => api(`/api/v1/prioridades/categorias/${c.id}`, { method: "DELETE" }), "Categoría eliminada")) void recargar();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ),
                ])}
              />
            </Seccion>
          </>
        )}
      </Estado>

      <Modal abierto={nueva} titulo="Nueva categoría" onCerrar={() => setNueva(false)}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await accion(() => api("/api/v1/prioridades/categorias", { method: "POST", json: form }), "Categoría creada")) {
              setNueva(false);
              void recargar();
            }
          }}
        >
          <div><Label htmlFor="cod">Código</Label><Input id="cod" required placeholder="NINO_PEQUENO" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} /></div>
          <div><Label htmlFor="nom">Nombre</Label><Input id="nom" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><Label htmlFor="pes">Peso (0–1000)</Label><Input id="pes" type="number" min={0} max={1000} value={form.pesoBase} onChange={(e) => setForm({ ...form, pesoBase: Number(e.target.value) })} /></div>
          <div>
            <Label htmlFor="doc">Documento a verificar</Label>
            <NativeSelect id="doc" value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })}>{DOCS.map((d) => <option key={d} value={d}>{d}</option>)}</NativeSelect>
          </div>
          <label className="flex items-center justify-between text-sm">El cliente puede elegirla <Switch checked={form.visibleCliente} onCheckedChange={(v) => setForm({ ...form, visibleCliente: v })} /></label>
          <Button type="submit" className="w-full">Crear</Button>
        </form>
      </Modal>
    </div>
  );
}
