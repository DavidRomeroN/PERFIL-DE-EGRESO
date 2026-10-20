/**
 * Puntos de extensión del núcleo (puertos). Un módulo opcional los implementa como bean y el núcleo los usa sin
 * conocerlo:
 * <ul>
 *   <li>{@link pe.turnoya.nucleo.puertos.PoliticaPrioridad}: M1 Prioridades.</li>
 *   <li>{@link pe.turnoya.nucleo.puertos.EstimadorEspera}: M2 Predicción de espera.</li>
 *   <li>{@link pe.turnoya.nucleo.puertos.OfertaCitas}: M3 Citas.</li>
 *   <li>{@link pe.turnoya.nucleo.puertos.AvisosDelTurno}: historial de avisos (módulo notificaciones).</li>
 * </ul>
 * Cada implementación dice si {@code aplica} al local (por ejemplo, si su módulo está encendido); el núcleo toma la
 * primera que aplica y, si ninguna, usa la suya por defecto.
 */
@NamedInterface("puertos")
package pe.turnoya.nucleo.puertos;

import org.springframework.modulith.NamedInterface;
