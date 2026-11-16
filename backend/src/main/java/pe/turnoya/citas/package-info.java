/**
 * M3 · Citas: reserva de horarios sin sobrecupo, confirmación, reprogramación, recordatorios, check-in con PIN de
 * presencia (la cita se vuelve un turno con prioridad CITA), inasistencias y bloqueos.
 *
 * <p>Se conecta con el núcleo implementando {@link pe.turnoya.nucleo.puertos.OfertaCitas}, emitiendo turnos por
 * {@code TomaDeTurnos.porCita} y escuchando {@code TurnoCerrado} para cerrar la cita.
 *
 * <p>Slices: {@code agenda} (slots y disponibilidad), {@code reserva} (reservar, confirmar, cancelar, reprogramar),
 * {@code checkin} (check-in, PIN, inasistencias y recordatorios) y {@code administracion} (agenda del local y configuración).
 */
@ApplicationModule(displayName = "Citas (M3)")
package pe.turnoya.citas;

import org.springframework.modulith.ApplicationModule;
