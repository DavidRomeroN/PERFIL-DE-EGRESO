/**
 * M6 · Transferencia de turnos entre colas (conservando el lugar) y balanceo automático por reglas con simulación,
 * histéresis, enfriamiento y confirmación.
 *
 * <p>Transfiere por {@code TomaDeTurnos.transferir} (núcleo) y avisa al cliente por {@code AvisosAlCliente}. Publica
 * {@link pe.turnoya.balanceo.AlertaBalanceo} para Analítica (M7).
 *
 * <p>Slices: {@code transferencias} (transferir un turno, historial, bloque del panel) y {@code reglas} (métricas de carga,
 * reglas, evaluador cada 30 s, confirmaciones y la página del admin).
 */
@ApplicationModule(displayName = "Transferencia y balanceo (M6)")
package pe.turnoya.balanceo;

import org.springframework.modulith.ApplicationModule;
