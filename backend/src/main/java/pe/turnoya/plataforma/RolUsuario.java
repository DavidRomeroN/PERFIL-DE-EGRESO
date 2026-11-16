package pe.turnoya.plataforma;

public enum RolUsuario {
    SUPER_ADMIN("Super administrador"),
    ADMIN_LOCAL("Administrador del local"),
    OPERADOR("Operador de ventanilla"),
    /** Recepción: ve las colas, emite tickets para cualquiera y transfiere clientes. No llama turnos. */
    KIOSCO("Kiosco (solo tickets)");

    private final String etiqueta;

    RolUsuario(String etiqueta) {
        this.etiqueta = etiqueta;
    }

    public String etiqueta() {
        return etiqueta;
    }

    public boolean esAdmin() {
        return this == SUPER_ADMIN || this == ADMIN_LOCAL;
    }

    /** Página a la que entra después de iniciar sesión. */
    public String inicio() {
        return switch (this) {
            case SUPER_ADMIN, ADMIN_LOCAL -> "/admin";
            case OPERADOR -> "/panel";
            case KIOSCO -> "/panel-kiosco";
        };
    }
}
