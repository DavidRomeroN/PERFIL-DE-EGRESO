package pe.turnoya.nucleo.dominio;

import java.util.Optional;

/** Puerto de salida: Clientes de los turnos (nombre y celular cifrado). Lo implementa {@code infraestructura.ClientesJdbc}. */
public interface RepositorioClientes {

    /**
     * Un celular = un cliente: el índice único parcial sobre {@code telefono_hash} hace que dos emisiones simultáneas
     * del mismo número terminen en el mismo cliente.
     */
    int guardarPorTelefono(String hash, String cifrado, String nombre);

    int crearConNombre(String nombre);

    Optional<DatosCliente> datos(int clienteId);

    record DatosCliente(String nombre, String telefonoCifrado) {
    }
}
