import { EventEmitter } from "events";

/**
 * Bus de eventos en tiempo real (patrón observador).
 * Los eventos de dominio se publican por local y se entregan a los clientes
 * conectados por Server-Sent Events (/api/v1/realtime/:slug).
 *
 * Eventos: cola:actualizada · turno:llamado · turno:estado · notificacion:nueva
 */

export type EventoRealtime =
  | { tipo: "cola:actualizada"; localId: number; colaId?: number }
  | {
      tipo: "turno:llamado";
      localId: number;
      turno: { id: number; codigo: string; token: string; ventanilla: string; cola: string; rellamada: boolean };
    }
  | { tipo: "turno:estado"; localId: number; turno: { id: number; token: string; estado: string } }
  | { tipo: "notificacion:nueva"; localId: number; notificacion: { id: number; turnoId: number; mensaje: string; destino: string | null } };

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
