"use client";

import { useEffect, useRef } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { MotionConfig } from "motion/react";
import type { EstadoConexion } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";

/**
 * Piezas de movimiento compartidas.
 * Regla: se anima lo que comunica algo (llega un dato nuevo, cambia un estado, aparece contenido),
 * nunca lo que el usuario repite cientos de veces al día.
 */

/** Respeta "reducir movimiento" del sistema operativo en todas las animaciones de motion. */
export function ProveedorMovimiento({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Revela el contenido al entrar en pantalla (una sola vez).
 * Lo que ya está visible al cargar no se anima ni se oculta: solo lo que queda debajo del pliegue.
 */
export function Revelar({ children, retraso = 0, className, as: Tag = "div" }: { children: React.ReactNode; retraso?: number; className?: string; as?: "div" | "section" | "li" | "article" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.dataset.revelar = "oculto";
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.dataset.revelar = "visible";
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as React.Ref<never>} className={className} style={{ ["--retraso" as string]: `${retraso}ms` }}>
      {children}
    </Tag>
  );
}

/** Número que transiciona dígito a dígito cuando cambia (datos en vivo). En la carga inicial no anima. */
export function Numero({ valor, prefijo, sufijo, formato, className }: { valor: number; prefijo?: string; sufijo?: string; formato?: Format; className?: string }) {
  return <NumberFlow value={valor} prefix={prefijo} suffix={sufijo} format={formato} locales="es-PE" className={cn("tabular-nums", className)} willChange />;
}

/** Check que se dibuja trazo a trazo: confirma que algo terminó bien (turno atendido, cita reservada, pago aprobado). */
export function CheckAnimado({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-14 animate-pop items-center justify-center rounded-full bg-emerald-100 text-emerald-600 ring-8 ring-emerald-50", className)}>
      <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray={24} className="animate-draw" style={{ ["--largo" as string]: 24 }} />
      </svg>
    </span>
  );
}

/** Indicador "En vivo" con pulso; ámbar cuando el canal SSE se está reconectando. */
export function EnVivo({ estado, className, oscuro = false, etiqueta = true }: { estado: EstadoConexion; className?: string; oscuro?: boolean; etiqueta?: boolean }) {
  const ok = estado === "conectado";
  const texto = ok ? "En vivo" : estado === "conectando" ? "Conectando" : "Reconectando";
  return (
    <span
      role="status"
      title={texto}
      className={cn(
        "inline-flex items-center gap-2 text-xs font-medium transition-colors duration-300",
        etiqueta && "rounded-full border px-2.5 py-1",
        oscuro ? "border-white/15 text-white/80" : ok ? "border-emerald-200 bg-emerald-50/70 text-emerald-800" : "border-amber-200 bg-amber-50/70 text-amber-800",
        className,
      )}
    >
      <span className="relative flex size-2">
        {ok && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-live" />}
        <span className={cn("relative size-2 rounded-full transition-colors duration-300", ok ? "bg-emerald-500" : "bg-amber-500")} />
      </span>
      {etiqueta ? texto : <span className="sr-only">{texto}</span>}
    </span>
  );
}
