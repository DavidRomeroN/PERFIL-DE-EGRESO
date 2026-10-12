import { EventEmitter } from "events";

/**
 * Bus de eventos en tiempo real (patrón observador).
 * Los eventos de dominio se publican por local y se entregan a los clientes
 * conectados por Server-Sent Events (/api/v1/realtime/:slug).
 *
 * La app corre en una sola instancia (ver docs/ARQUITECTURA.md, F2): el bus en memoria basta y los jobs
 * corren en el mismo proceso. Para varias instancias se reemplazaría el interior por LISTEN/NOTIFY sin
 * cambiar `publicar`/`suscribir`.
 *
 * Eventos: cola:actualizada · turno:llamado · turno:estado · notificacion:nueva ·
 *          prioridad:config (M1) · cita:estado (M3) · bot:mensaje · bot:handoff (M4) ·
 *          kiosco:estado · kiosco:evento (M5) · balanceo:accion (M6) · alerta:nueva · alerta:actualizada (M7) ·
 *          prediccion:modelo (M2)
 */

export type EventoRealtime =
  | { tipo: "cola:actualizada"; localId: number; colaId?: number }
  | {
      tipo: "turno:llamado";
      localId: number;
      turno: { id: number; codigo: string; token: string; ventanilla: string; cola: string; rellamada: boolean; codigoProvisional?: string | null };
    }
  | { tipo: "turno:estado"; localId: number; turno: { id: number; token: string; estado: string } }
  | { tipo: "notificacion:nueva"; localId: number; notificacion: { id: number; turnoId: number; mensaje: string; destino: string | null } }
  | { tipo: "prioridad:config"; localId: number }
  | { tipo: "cita:estado"; localId: number; cita: { id: number; token: string; estado: string } }
  | { tipo: "bot:mensaje"; localId: number; conversacionId: string }
  | { tipo: "bot:handoff"; localId: number; conversacionId: string; activo: boolean }
  | { tipo: "kiosco:estado"; localId: number; dispositivoId: number; enLinea: boolean }
  | { tipo: "kiosco:evento"; localId: number; dispositivoId: number; estado: string }
  | { tipo: "balanceo:accion"; localId: number; reglaId: number; resultado: string }
  | { tipo: "alerta:nueva" | "alerta:actualizada"; localId: number; alerta: { id: string; titulo: string; nivel: number; estado: string } }
  | { tipo: "prediccion:modelo"; localId: number; colaId: number; modelo: string; deriva: boolean };

const globalForBus = globalThis as unknown as { turnoyaBus?: EventEmitter };

export const bus: EventEmitter = globalForBus.turnoyaBus ?? new EventEmitter();
bus.setMaxListeners(1000);
globalForBus.turnoyaBus = bus;

export function publicar(evento: EventoRealtime) {
  bus.emit(`local:${evento.localId}`, evento);
}

export function suscribir(localId: number, handler: (e: EventoRealtime) => void) {
  const canal = `local:${localId}`;
  bus.on(canal, handler);
  return () => bus.off(canal, handler);
}
