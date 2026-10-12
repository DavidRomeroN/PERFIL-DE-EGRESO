"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, CalendarClock, History, KeyRound, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Modal, accion } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface EstadoModulo {
  codigo: string;
  habilitado: boolean;
}

interface Explicacion {
  codigo: string;
  categoria: string;
  texto: string;
  total: number;
}

const MOTIVOS = [
  ["ERROR_DE_COLA", "Llegó a la cola equivocada"],
  ["OTRO_SERVICIO", "Necesita otro servicio"],
  ["DERIVACION", "Derivación interna"],
  ["FALTA_DOCUMENTO", "Falta un documento"],
] as const;

/**
 * Bloques del panel que dependen de módulos (solo se muestran si el módulo está activo):
 * M1 explicación del puntaje · M6 transferir · M3 citas próximas y PIN de presencia · N02 historial.
 */
export function PanelModulos({ localId, colaId, colas, actual, espera, onCambio }: {
  localId: number;
  colaId: number | null;
  colas: { id: number; nombre: string; enEspera: number }[];
  actual: { id: number; codigo: string; colaId?: number } | null;
  espera: { id: number; codigo: string }[];
  onCambio: () => void;
}) {
  const q = `localId=${localId}`;
  const [mods, setMods] = useState<Set<string>>(new Set());
  const [exp, setExp] = useState<Explicacion | null>(null);
  const [citas, setCitas] = useState<{ id: number; hora: string; cola: string; nombre: string | null; estado: string; codigoCheckin: string }[]>([]);
  const [pin, setPin] = useState<{ pin: string; segundosRestantes: number } | null>(null);
  const [transferir, setTransferir] = useState<{ id: number; codigo: string } | null>(null);
  const [destino, setDestino] = useState<number>(0);
  const [motivo, setMotivo] = useState<string>("ERROR_DE_COLA");
  const [detalle, setDetalle] = useState("");

  useEffect(() => {
    api<EstadoModulo[]>(`/api/v1/modulos?${q}`).then((m) => setMods(new Set(m.filter((x) => x.habilitado).map((x) => x.codigo)))).catch(() => {});
  }, [q]);

  const refrescar = useCallback(async () => {
    if (mods.has("M1")) setExp(await api<Explicacion | null>(`/api/v1/prioridades/explicacion?${q}${colaId ? `&colaId=${colaId}` : ""}`).catch(() => null));
    if (mods.has("M3")) setCitas(await api<typeof citas>(`/api/v1/citas/proximas?${q}`).catch(() => []));
  }, [mods, q, colaId]);

  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), 20_000);
    return () => clearInterval(t);
  }, [refrescar, espera.length]);

  useEffect(() => {
    if (!mods.has("M3")) return;
    const cargar = () => api<{ pin: string; segundosRestantes: number } | null>(`/api/v1/citas/pin?${q}`).then(setPin).catch(() => setPin(null));
    void cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [mods, q]);

  async function confirmarTransferencia() {
    if (!transferir || !destino) return;
    const r = await accion(() => api(`/api/v1/turnos/${transferir.id}/transferir?${q}`, { method: "POST", json: { aColaId: destino, motivo, detalle: detalle || null } }), `Turno ${transferir.codigo} transferido conservando su lugar`);
    if (r) {
      setTransferir(null);
      setDetalle("");
      onCambio();
    }
  }

  const otrasColas = colas.filter((c) => c.id !== (actual?.colaId ?? colaId));

  return (
    <div className="space-y-3">
      {mods.has("M1") && exp && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Scale className="size-3.5" /> Por qué {exp.codigo} es el siguiente</p>
          <p className="mt-1 text-sm"><b>{exp.categoria}</b> · {exp.texto}</p>
        </div>
      )}

      {mods.has("M6") && (actual || espera.length > 0) && otrasColas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-4">
          <ArrowRightLeft className="size-4 text-muted-foreground" />
          <span className="text-sm">Transferir a otra cola (conserva su lugar):</span>
          {actual && <Button size="sm" variant="outline" onClick={() => { setTransferir(actual); setDestino(otrasColas[0].id); }}>{actual.codigo} (actual)</Button>}
          <NativeSelect aria-label="Turno en espera a transferir" className="h-8 w-36" value="" onChange={(e) => { const t = espera.find((x) => x.id === Number(e.target.value)); if (t) { setTransferir(t); setDestino(otrasColas[0].id); } }}>
            <option value="">En espera…</option>
            {espera.slice(0, 30).map((t) => <option key={t.id} value={t.id}>{t.codigo}</option>)}
          </NativeSelect>
        </div>
      )}

      {mods.has("M3") && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-medium"><CalendarClock className="size-4" /> Citas próximas (60 min)</p>
            {pin && <p className="flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 font-mono text-sm text-teal-800" title={`Cambia en ${pin.segundosRestantes} s`}><KeyRound className="size-3.5" /> PIN {pin.pin}</p>}
          </div>
          {citas.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Sin citas en la próxima hora.</p> : (
            <ul className="mt-2 divide-y text-sm">
              {citas.map((c) => (
                <li key={c.id} className="flex justify-between py-1.5"><span><b>{c.hora}</b> · {c.nombre ?? "Cliente"} · {c.cola}</span><span className="text-xs text-muted-foreground">{c.estado} · {c.codigoCheckin}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button asChild variant="ghost" size="sm" className="w-full">
        <Link href="/panel/historial"><History className="size-4" /> Historial del día</Link>
      </Button>

      <Modal abierto={!!transferir} titulo={`Transferir ${transferir?.codigo ?? ""}`} onCerrar={() => setTransferir(null)}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="destino">Cola destino</Label>
            <NativeSelect id="destino" value={destino} onChange={(e) => setDestino(Number(e.target.value))}>
              {otrasColas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.enEspera} en espera</option>)}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="motivo">Motivo</Label>
            <NativeSelect id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {MOTIVOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="detalle">Detalle (opcional)</Label>
            <Input id="detalle" maxLength={200} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">El cliente conserva su hora de llegada y prioridad, recibe un aviso con su nuevo código y su enlace de seguimiento sigue funcionando.</p>
          <Button className="w-full" onClick={confirmarTransferencia}>Transferir</Button>
        </div>
      </Modal>
    </div>
  );
}
