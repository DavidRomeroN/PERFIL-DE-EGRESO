/**
 * Núcleo de la fila virtual: colas, ventanillas y turnos (emitir, llamar, atender, cancelar, avisar, expirar).
 *
 * <p>API pública:
 * <ul>
 *   <li>Este paquete: {@link pe.turnoya.nucleo.ConsultaTurnos}, {@link pe.turnoya.nucleo.ContactoTurnos} y los tipos
 *       que devuelven.</li>
 *   <li>{@code nucleo.eventos}: lo que el núcleo anuncia (turno llamado, cerrado, avisado…). Otros módulos reaccionan
 *       escuchando, sin que el núcleo los llame (sin código en cascada).</li>
 *   <li>{@code nucleo.puertos}: puntos de extensión que implementan los módulos opcionales (M1 prioridades,
 *       M2 predicción, M3 citas). Si nadie los implementa, el núcleo se comporta como el original.</li>
 * </ul>
 *
 * <p>Depende solo de {@code compartido} y {@code plataforma}.
 */
@ApplicationModule(displayName = "Núcleo de turnos")
package pe.turnoya.nucleo;

import org.springframework.modulith.ApplicationModule;
