package pe.turnoya.nucleo.infraestructura;

import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.nucleo.dominio.RepositorioClientes;

/** Acceso a la tabla {@code cliente} (datos personales mínimos: nombre y celular cifrado). */
@Repository
class ClientesJdbc implements RepositorioClientes {

    private final JdbcClient jdbc;

    ClientesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Un celular = un cliente: el índice único parcial sobre {@code telefono_hash} hace que dos emisiones simultáneas
     * del mismo número terminen en el mismo cliente.
     */
    @Override
    public int guardarPorTelefono(String hash, String cifrado, String nombre) {
        return jdbc.sql("""
                        INSERT INTO cliente (telefono_hash, telefono_cifrado, nombre, consentimiento_at)
                        VALUES (:hash, :cifrado, :nombre, now())
                        ON CONFLICT (telefono_hash) WHERE telefono_hash IS NOT NULL
                        DO UPDATE SET nombre = COALESCE(EXCLUDED.nombre, cliente.nombre),
                                      telefono_cifrado = COALESCE(cliente.telefono_cifrado, EXCLUDED.telefono_cifrado),
                                      consentimiento_at = now()
                        RETURNING id""")
                .param("hash", hash).param("cifrado", cifrado).param("nombre", nombre)
                .query(Integer.class).single();
    }

    @Override
    public int crearConNombre(String nombre) {
        return jdbc.sql("INSERT INTO cliente (nombre) VALUES (:nombre) RETURNING id").param("nombre", nombre).query(Integer.class).single();
    }

    @Override
    public Optional<DatosCliente> datos(int clienteId) {
        return jdbc.sql("SELECT nombre, telefono_cifrado FROM cliente WHERE id = :id")
                .param("id", clienteId)
                .query((rs, i) -> new DatosCliente(rs.getString("nombre"), rs.getString("telefono_cifrado")))
                .optional();
    }

}
