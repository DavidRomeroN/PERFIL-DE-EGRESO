/**
 * Notificaciones: avisos al cliente por WhatsApp (o solo web si el plan no lo incluye o se agotó el cupo).
 *
 * <p>Escucha los eventos del núcleo (turno avisado, llamado, vencido) y decide el canal; el núcleo no sabe que este
 * módulo existe. Cada aviso queda en la tabla {@code notificacion} y se anuncia con {@link
 * pe.turnoya.notificaciones.NotificacionRegistrada} para que "mi turno" lo muestre al instante.
 */
@ApplicationModule(displayName = "Notificaciones")
package pe.turnoya.notificaciones;

import org.springframework.modulith.ApplicationModule;
