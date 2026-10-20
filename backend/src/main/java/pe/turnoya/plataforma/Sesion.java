package pe.turnoya.plataforma;

/**
 * Usuario autenticado. Viaja firmado en la cookie {@code turnoya_session} (JWT HS256) con los mismos campos que
 * en legacy/, así una sesión iniciada en un sistema sirve en el otro durante la migración.
 */
public record Sesion(
        int sub,
        String email,
        String nombre,
        RolUsuario rol,
        Integer localId,
        String localSlug,
        String localNombre) {

    public boolean esSuperAdmin() {
        return rol == RolUsuario.SUPER_ADMIN;
    }

    public boolean esAdmin() {
        return rol.esAdmin();
    }
}
