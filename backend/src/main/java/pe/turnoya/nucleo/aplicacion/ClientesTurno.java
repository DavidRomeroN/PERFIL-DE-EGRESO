package pe.turnoya.nucleo.aplicacion;

import org.springframework.stereotype.Component;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.nucleo.infraestructura.ClientesJdbc;

/**
 * Busca o crea el cliente de un turno a partir del celular (cifrado + hash) o solo del nombre.
 * Ley 29733: sin consentimiento no se guarda el celular.
 */
@Component
class ClientesTurno {

    private final ClientesJdbc clientes;
    private final CifradoDatos cifrado;

    ClientesTurno(ClientesJdbc clientes, CifradoDatos cifrado) {
        this.clientes = clientes;
        this.cifrado = cifrado;
    }

    Integer resolver(String telefono, String nombre, boolean consentimiento) {
        boolean conTelefono = telefono != null && !telefono.isBlank();
        String e164 = conTelefono
                ? Telefonos.normalizar(telefono).orElseThrow(() -> new ErrorNegocio("TELEFONO_INVALIDO", "El celular no es válido (9 dígitos, ej. 951234567)"))
                : null;
        if (e164 != null && !consentimiento) {
            throw new ErrorNegocio("CONSENTIMIENTO_REQUERIDO", "Debes aceptar la política de datos para recibir avisos por WhatsApp");
        }
        String limpio = nombre == null || nombre.isBlank() ? null : nombre.trim().substring(0, Math.min(60, nombre.trim().length()));
        if (e164 != null) {
            return clientes.guardarPorTelefono(Telefonos.hash(e164), cifrado.cifrar(e164), limpio);
        }
        return limpio == null ? null : clientes.crearConNombre(limpio);
    }
}
