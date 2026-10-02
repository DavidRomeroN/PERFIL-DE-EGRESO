"use client";

import { useEffect, useRef, useState } from "react";
import type { EventoRealtime } from "@/lib/realtime";

export type EstadoConexion = "conectando" | "conectado" | "desconectado";

/**
 * Suscripción SSE a /api/v1/realtime/:slug.
 * Reconecta automáticamente (EventSource) y notifica cada evento de dominio.
 */
export function useRealtime(slug: string | null | undefined, onEvento: (e: EventoRealtime) => void) {
  const [estado, setEstado] = useState<EstadoConexion>("conectando");
  const handlerRef = useRef(onEvento);
  useEffect(() => {
    handlerRef.current = onEvento;
  });

  useEffect(() => {
    if (!slug) return;
    const es = new EventSource(`/api/v1/realtime/${slug}`);
    const tipos = ["cola:actualizada", "turno:llamado", "turno:estado", "notificacion:nueva"] as const;

    es.addEventListener("conectado", () => setEstado("conectado"));
    es.onopen = () => setEstado("conectado");
    es.onerror = () => setEstado("desconectado");
    const listeners = tipos.map((t) => {
      const fn = (ev: MessageEvent) => {
        try {
          handlerRef.current(JSON.parse(ev.data) as EventoRealtime);
        } catch {
          /* ignorar */
        }
      };
      es.addEventListener(t, fn);
      return [t, fn] as const;
    });

    return () => {
      listeners.forEach(([t, fn]) => es.removeEventListener(t, fn));
      es.close();
    };
  }, [slug]);

  return estado;
}
