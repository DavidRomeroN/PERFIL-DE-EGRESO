package pe.turnoya.plataforma.infraestructura;

import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.plataforma.RolUsuario;

/** Acceso a la tabla {@code usuario} (con los datos del local para armar la sesión). */
@Repository
public class UsuariosJdbc {

    private final JdbcClient jdbc;

    public UsuariosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<UsuarioConLocal> porEmail(String email) {
        return jdbc.sql("""
                        SELECT u.id, u.email, u.nombre, u.rol::text AS rol, u.hash_password, u.activo, u.local_id,
                               l.slug, l.nombre_comercial, l.activo AS local_activo
                          FROM usuario u LEFT JOIN local l ON l.id = u.local_id
                         WHERE u.email = :email""")
                .param("email", email)
                .query((rs, i) -> new UsuarioConLocal(
                        rs.getInt("id"), rs.getString("email"), rs.getString("nombre"), RolUsuario.valueOf(rs.getString("rol")),
                        rs.getString("hash_password"), rs.getBoolean("activo"), Sql.entero(rs, "local_id"),
                        rs.getString("slug"), rs.getString("nombre_comercial"), Sql.booleano(rs, "local_activo")))
                .optional();
    }

    public void registrarAcceso(int usuarioId, Instant ahora) {
        jdbc.sql("UPDATE usuario SET ultimo_acceso = :ahora WHERE id = :id")
                .param("ahora", Sql.utc(ahora)).param("id", usuarioId).update();
    }

    public record UsuarioConLocal(int id, String email, String nombre, RolUsuario rol, String hashPassword, boolean activo,
                                  Integer localId, String localSlug, String localNombre, Boolean localActivo) {
    }
}
