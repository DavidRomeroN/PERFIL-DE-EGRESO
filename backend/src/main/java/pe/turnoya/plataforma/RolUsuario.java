package pe.turnoya.plataforma;

public enum RolUsuario {
    SUPER_ADMIN("Super administrador"),
    ADMIN_LOCAL("Administrador del local"),
    OPERADOR("Operador de ventanilla");

    private final String etiqueta;

    RolUsuario(String etiqueta) {
        this.etiqueta = etiqueta;
    }

    public String etiqueta() {
        return etiqueta;
    }

    public boolean esAdmin() {
        return this != OPERADOR;
    }
}
