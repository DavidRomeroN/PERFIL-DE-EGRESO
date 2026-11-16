package pe.turnoya.plataforma.dominio;

import java.time.Instant;
import java.util.Optional;
import pe.turnoya.plataforma.RolUsuario;

/** Puerto de salida: Usuarios del personal, con los datos de su local para armar la sesión. Lo implementa {@code infraestructura.UsuariosJdbc}. */
public interface RepositorioUsuarios {

    Optional<UsuarioConLocal> porEmail(String email);

    void registrarAcceso(int usuarioId, Instant ahora);

    /** Personal de un local, primero los administradores. */
    java.util.List<UsuarioFila> delLocal(int localId);

    Optional<UsuarioFila> porIdEnLocal(int id, int localId);

    boolean existeEmail(String email, Integer excepto);

    UsuarioFila crear(int localId, String nombre, String email, RolUsuario rol, boolean activo, String hashPassword);

    UsuarioFila actualizar(int id, String nombre, String email, RolUsuario rol, boolean activo, String hashPasswordONulo);

    void eliminar(int id);

    record UsuarioFila(int id, String nombre, String email, RolUsuario rol, boolean activo, Instant createdAt, Instant ultimoAcceso,
                       Integer localId) {
    }

    record UsuarioConLocal(int id, String email, String nombre, RolUsuario rol, String hashPassword, boolean activo,
                                  Integer localId, String localSlug, String localNombre, Boolean localActivo) {
    }
}
