/**
 * Eventos del núcleo. Se publican dentro de la transacción que produjo el cambio; los oyentes de otros módulos
 * ({@code @ApplicationModuleListener}) los reciben después del commit y quedan registrados (outbox) hasta
 * procesarse. No llevan datos personales: quien necesite el celular lo consulta con {@code ContactoTurnos}.
 */
@NamedInterface("eventos")
package pe.turnoya.nucleo.eventos;

import org.springframework.modulith.NamedInterface;
