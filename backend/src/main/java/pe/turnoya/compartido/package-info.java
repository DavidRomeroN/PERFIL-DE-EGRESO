/**
 * Núcleo compartido (shared kernel): errores de negocio, tiempo, protección de datos personales, configuración,
 * acceso a datos y piezas web comunes.
 *
 * <p>Es un módulo abierto: cualquier módulo puede usar sus subpaquetes. Aquí no hay reglas de negocio de
 * turnos, colas ni planes; solo lo que todos necesitan por igual.
 */
@ApplicationModule(displayName = "Compartido", type = ApplicationModule.Type.OPEN)
package pe.turnoya.compartido;

import org.springframework.modulith.ApplicationModule;
