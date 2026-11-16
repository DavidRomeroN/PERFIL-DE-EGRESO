package pe.turnoya.plataforma;

/** Módulos opcionales que un plan puede incluir y el admin del local encender (F3). */
public enum Modulo {
    M1("Prioridades", "Atención preferente (adulto mayor, gestante…) sin que nadie se quede atrás", "/admin/modulos/prioridades"),
    M2("Predicción de espera", "Le dice al cliente cuánto le falta y a qué hora conviene venir", "/admin/modulos/prediccion"),
    M3("Citas y reservas", "El cliente reserva su hora y confirma su llegada con el QR del local", "/admin/modulos/citas"),
    M5("Kiosco offline", "Pantalla táctil para sacar turno sin celular, aunque se caiga internet", "/admin/modulos/kiosco"),
    M6("Transferencias", "Pasar a un cliente de una cola a otra sin que pierda su lugar", "/admin/modulos/transferencias"),
    M7("Analítica y SLA", "Horas más llenas, cumplimiento de tu meta de espera, alertas y reportes", "/admin/analitica"),
    M8("Simulador de capacidad", "Calcula cuántas ventanillas necesitas para que nadie espere de más", "/admin/simulador");

    private final String nombre;
    private final String descripcion;
    private final String ruta;

    Modulo(String nombre, String descripcion, String ruta) {
        this.nombre = nombre;
        this.descripcion = descripcion;
        this.ruta = ruta;
    }

    public String nombre() {
        return nombre;
    }

    public String descripcion() {
        return descripcion;
    }

    /** Página de configuración del módulo en el panel de administración. */
    public String ruta() {
        return ruta;
    }
}
