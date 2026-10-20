/**
 * Tiempo real: lleva los eventos del local a las pantallas conectadas por Server-Sent Events
 * ({@code /api/v1/realtime/:slug}): TV, panel de ventanilla y "mi turno".
 *
 * <p>Traduce los eventos de dominio al formato JSON de legacy/ ({@code cola:actualizada}, {@code turno:llamado},
 * {@code turno:estado}, {@code notificacion:nueva}) y los reparte con un bus: en memoria para una instancia o por
 * Redis pub/sub cuando hay varias réplicas ({@code turnoya.tiempo-real.bus=redis}).
 */
@ApplicationModule(displayName = "Tiempo real")
package pe.turnoya.tiemporeal;

import org.springframework.modulith.ApplicationModule;
