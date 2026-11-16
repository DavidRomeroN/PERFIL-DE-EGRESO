/**
 * M6 · Transferencias: pasar a un cliente de una cola a otra sin que pierda su lugar (conserva su hora de llegada y su
 * prioridad). Lo hacen el operador desde su panel y el usuario de kiosco desde el suyo; el cliente recibe un aviso con su
 * nuevo código.
 *
 * <p>Transfiere por {@code TomaDeTurnos.transferir} (núcleo) y avisa al cliente por {@code AvisosAlCliente}. API pública:
 * {@link pe.turnoya.transferencias.Transferencias}. El antiguo balanceo automático por reglas se retiró.
 */
@ApplicationModule(displayName = "Transferencias (M6)")
package pe.turnoya.transferencias;

import org.springframework.modulith.ApplicationModule;
