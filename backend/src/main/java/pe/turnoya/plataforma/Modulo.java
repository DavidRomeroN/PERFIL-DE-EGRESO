package pe.turnoya.plataforma;

/** Módulos opcionales que un plan puede incluir y el admin del local encender (F3). */
public enum Modulo {
    M1("Prioridades"),
    M2("Predicción de espera"),
    M3("Citas y reservas"),
    M4("Chatbot de WhatsApp"),
    M5("Kiosco offline"),
    M6("Transferencia y balanceo"),
    M7("Analítica y SLA"),
    M8("Simulador de capacidad");

    private final String nombre;

    Modulo(String nombre) {
        this.nombre = nombre;
    }

    public String nombre() {
        return nombre;
    }
}
