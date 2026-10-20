package pe.turnoya.notificaciones.dominio;

/** Textos de los avisos (equivalentes a las plantillas aprobadas en Meta). Mismos textos que legacy/. */
public final class Plantillas {

    public static final String TURNO_PROXIMO = "turno_proximo";
    public static final String TURNO_LLAMADO = "turno_llamado";
    public static final String TURNO_VENCIDO = "turno_vencido";

    private Plantillas() {
    }

    public static String turnoProximo(String nombre, String codigo, String local, int faltan, String url) {
        String saludo = nombre != null && !nombre.isBlank() ? "Hola " + nombre.trim().split(" ")[0] + " 👋" : "Hola 👋";
        String cuantos = faltan <= 0 ? "ya casi es tu turno" : faltan == 1 ? "falta 1 persona" : "faltan " + faltan + " personas";
        return saludo + ", tu turno *" + codigo + "* en *" + local + "* está por llegar: " + cuantos
                + ". Acércate a la sala. Sigue tu turno aquí: " + url;
    }

    public static String turnoLlamado(String codigo, String ventanilla, String local) {
        return "📣 *" + codigo + "*, es tu turno en *" + local + "*. Acércate a *" + ventanilla + "*.";
    }

    public static String turnoVencido(String codigo, String local) {
        return "Tu turno *" + codigo + "* en *" + local + "* venció porque no te presentaste a tiempo. "
                + "Puedes tomar uno nuevo desde el enlace del local.";
    }
}
