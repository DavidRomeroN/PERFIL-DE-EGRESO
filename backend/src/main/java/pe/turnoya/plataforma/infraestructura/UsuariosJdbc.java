package pe.turnoya.plataforma.infraestructura;

import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios;

/** Acceso a la tabla {@code usuario} (con los datos del local para armar la sesión). */
@Repository
class UsuariosJdbc implements RepositorioUsuarios {

    private final JdbcClient jdbc;

    UsuariosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
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

    @Override
    public void registrarAcceso(int usuarioId, Instant ahora) {
        jdbc.sql("UPDATE usuario SET ultimo_acceso = :ahora WHERE id = :id")
                .param("ahora", Sql.utc(ahora)).param("id", usuarioId).update();
    }

    private static final String FILA = "SELECT id, nombre, email, rol::text AS rol, activo, created_at, ultimo_acceso, local_id FROM usuario";

    @Override
    public java.util.List<UsuarioFila> delLocal(int localId) {
        return jdbc.sql(FILA + " WHERE local_id = :local ORDER BY rol, nombre").param("local", localId).query(UsuariosJdbc::fila).list();
    }

    @Override
    public Optional<UsuarioFila> porIdEnLocal(int id, int localId) {
        return jdbc.sql(FILA + " WHERE id = :id AND local_id = :local").param("id", id).param("local", localId).query(UsuariosJdbc::fila).optional();
    }

    @Override
    public boolean existeEmail(String email, Integer excepto) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM usuario WHERE lower(email) = lower(:email) AND id <> COALESCE(:excepto, -1))")
                .param("email", email).param("excepto", excepto).query(Boolean.class).single();
    }

    @Override
    public UsuarioFila crear(int localId, String nombre, String email, RolUsuario rol, boolean activo, String hashPassword) {
        return jdbc.sql("""
                        INSERT INTO usuario (local_id, nombre, email, rol, activo, hash_password)
                        VALUES (:local, :nombre, :email, CAST(:rol AS "RolUsuario"), :activo, :hash)
                        RETURNING id, nombre, email, rol::text AS rol, activo, created_at, ultimo_acceso, local_id""")
                .param("local", localId).param("nombre", nombre).param("email", email).param("rol", rol.name())
                .param("activo", activo).param("hash", hashPassword)
                .query(UsuariosJdbc::fila).single();
    }

    @Override
    public UsuarioFila actualizar(int id, String nombre, String email, RolUsuario rol, boolean activo, String hashPasswordONulo) {
        return jdbc.sql("""
                        UPDATE usuario SET nombre = :nombre, email = :email, rol = CAST(:rol AS "RolUsuario"), activo = :activo,
                               hash_password = COALESCE(:hash, hash_password)
                         WHERE id = :id
                        RETURNING id, nombre, email, rol::text AS rol, activo, created_at, ultimo_acceso, local_id""")
                .param("id", id).param("nombre", nombre).param("email", email).param("rol", rol.name())
                .param("activo", activo).param("hash", hashPasswordONulo)
                .query(UsuariosJdbc::fila).single();
    }

    @Override
    public void eliminar(int id) {
        jdbc.sql("DELETE FROM usuario WHERE id = :id").param("id", id).update();
    }

    private static UsuarioFila fila(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new UsuarioFila(rs.getInt("id"), rs.getString("nombre"), rs.getString("email"), RolUsuario.valueOf(rs.getString("rol")),
                rs.getBoolean("activo"), Sql.instante(rs, "created_at"), Sql.instante(rs, "ultimo_acceso"), Sql.entero(rs, "local_id"));
    }
}
