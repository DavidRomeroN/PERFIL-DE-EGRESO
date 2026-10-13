"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import { AlertCircle, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import { Numero } from "@/components/app/motion";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

/** Piezas compartidas por las pantallas de los módulos M1–M8 (estado de carga, error, pestañas, secciones). */

export function useDatos<T>(url: string | null, deps: unknown[] = []) {
  const clave = JSON.stringify(deps);
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    if (!url) return;
    setCargando(true);
    try {
      setDatos(await api<T>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
    // `clave` fuerza la recarga cuando cambian dependencias que no están en la URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, clave]);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}

/** Ejecuta una acción con toast de éxito/error. Devuelve el resultado o null si falló. */
export async function accion<T>(fn: () => Promise<T>, exito?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (exito) toast.success(exito);
    return r;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Ocurrió un error");
    return null;
  }
}

export function Pestanas<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: { valor: T; etiqueta: string; contador?: number }[]; onCambio: (v: T) => void }) {
  const grupo = useId();
  return (
    <div role="tablist" className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-muted/80 p-1 ring-1 ring-border/60">
      {opciones.map((o) => {
        const activa = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => onCambio(o.valor)}
            className={cn("relative min-h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground", activa && "text-foreground")}
          >
            {activa && <motion.span layoutId={grupo} className="absolute inset-0 rounded-lg bg-card shadow-soft ring-1 ring-border/60" transition={{ type: "spring", duration: 0.35, bounce: 0.12 }} aria-hidden />}
            <span className="relative">
              {o.etiqueta}
              {o.contador ? <span className="ml-1.5 inline-block animate-pop rounded-full bg-rose-600 px-1.5 text-[11px] text-white tabular-nums">{o.contador}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Seccion({ titulo, descripcion, children, acciones, className }: { titulo: string; descripcion?: string; children: React.ReactNode; acciones?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold tracking-tight">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

export function Estado({ cargando, error, vacio, mensajeVacio, children }: { cargando: boolean; error: string | null; vacio?: boolean; mensajeVacio?: string; children: React.ReactNode }) {
  if (cargando)
    return (
      <div className="space-y-2.5" aria-busy="true" aria-label="Cargando">
        <div className="skeleton h-9 rounded-xl" />
        <div className="skeleton h-9 rounded-xl opacity-80" />
        <div className="skeleton h-9 w-2/3 rounded-xl opacity-60" />
      </div>
    );
  if (error)
    return (
      <p role="alert" className="flex animate-enter items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
      </p>
    );
  if (vacio)
    return (
      <div className="flex animate-enter flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Inbox className="size-6 opacity-50" /> {mensajeVacio ?? "Sin datos todavía."}
      </div>
    );
  return <>{children}</>;
}

export function Kpi({ etiqueta, valor, pista, tono = "default" }: { etiqueta: string; valor: React.ReactNode; pista?: string; tono?: "default" | "bien" | "alerta" | "mal" }) {
  const tonos = { default: "text-foreground", bien: "text-emerald-700", alerta: "text-amber-700", mal: "text-rose-700" };
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums transition-colors duration-300", tonos[tono])}>{typeof valor === "number" ? <Numero valor={valor} /> : valor}</p>
      {pista && <p className="mt-0.5 text-xs text-muted-foreground">{pista}</p>}
    </div>
  );
}

export function Tabla({ columnas, filas, vacio }: { columnas: string[]; filas: React.ReactNode[][]; vacio?: string }) {
  if (!filas.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Inbox className="size-6 opacity-50" /> {vacio ?? "Sin registros."}
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>{columnas.map((c, i) => <th key={`${i}-${c}`} scope="col" className="px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t transition-colors duration-150 hover:bg-muted/40">
              {f.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ abierto, titulo, onCerrar, children }: { abierto: boolean; titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  // Mientras se cierra se muestra el último contenido abierto: la salida no parpadea a un modal vacío
  const [visible, setVisible] = useState({ titulo, children });
  if (abierto && (visible.titulo !== titulo || visible.children !== children)) setVisible({ titulo, children });
  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/30 transition-opacity duration-200 ease-out supports-backdrop-filter:backdrop-blur-[2px] data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[starting-style]:opacity-0" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
          <DialogPrimitive.Popup className="pointer-events-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-card p-5 shadow-float ring-1 ring-foreground/10 outline-none transition-[translate,scale,opacity] duration-300 ease-drawer data-[ending-style]:translate-y-6 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[ending-style]:ease-out data-[starting-style]:translate-y-6 data-[starting-style]:opacity-0 sm:rounded-2xl sm:data-[ending-style]:translate-y-0 sm:data-[ending-style]:scale-[0.98] sm:data-[starting-style]:translate-y-2 sm:data-[starting-style]:scale-[0.96]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{visible.titulo}</DialogPrimitive.Title>
              <DialogPrimitive.Close aria-label="Cerrar" className="press rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            {visible.children}
          </DialogPrimitive.Popup>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function descargarCsv(nombre: string, filas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const blob = new Blob(["﻿" + filas.map((f) => f.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const fmtHora = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }) : "—");
export const fmtFechaHora = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short", hour12: false, timeZone: "America/Lima" }) : "—");
