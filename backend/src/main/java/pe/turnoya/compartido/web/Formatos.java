package pe.turnoya.compartido.web;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.tiempo.Fechas;

/**
 * Formatos para las plantillas: {@code ${@fmt.duracion(seg)}}, {@code ${@fmt.hora(instante)}}…
 * Mismas reglas que {@code frontend/src/lib/format.ts} de legacy/.
 */
@Component("fmt")
public class Formatos {

    private static final Locale ES_PE = Locale.of("es", "PE");
    private static final DateTimeFormatter HORA = DateTimeFormatter.ofPattern("hh:mm a", ES_PE).withZone(Fechas.LIMA);
    private static final DateTimeFormatter FECHA = DateTimeFormatter.ofPattern("dd/MM/yyyy", ES_PE).withZone(Fechas.LIMA);
    private static final DateTimeFormatter FECHA_HORA = DateTimeFormatter.ofPattern("dd MMM, hh:mm a", ES_PE).withZone(Fechas.LIMA);

    private final Clock reloj;

    public Formatos(Clock reloj) {
        this.reloj = reloj;
    }

    /** 0 min · &lt; 1 min · 12 min · 1 h 5 min */
    public String duracion(Number segundos) {
        if (segundos == null || segundos.doubleValue() <= 0) {
            return "0 min";
        }
        long min = Math.round(segundos.doubleValue() / 60);
        if (min < 1) {
            return "< 1 min";
        }
        if (min < 60) {
            return min + " min";
        }
        long h = min / 60;
        long m = min % 60;
        return m == 0 ? h + " h" : h + " h " + m + " min";
    }

    public String hora(Instant instante) {
        return instante == null ? "—" : HORA.format(instante);
    }

    public String fecha(Instant instante) {
        return instante == null ? "—" : FECHA.format(instante);
    }

    public String fechaHora(Instant instante) {
        return instante == null ? "—" : FECHA_HORA.format(instante);
    }

    public String haceCuanto(Instant instante) {
        if (instante == null) {
            return "";
        }
        long min = Duration.between(instante, reloj.instant()).toMinutes();
        if (min < 1) {
            return "hace un momento";
        }
        if (min < 60) {
            return "hace " + min + " min";
        }
        long h = min / 60;
        return "hace " + h + " h";
    }

    /** Segundos transcurridos desde un instante (contadores del panel). */
    public long segundosDesde(Instant instante) {
        return instante == null ? 0 : Math.max(0, Duration.between(instante, reloj.instant()).toSeconds());
    }

    /** Hora actual de Lima "HH:mm" (pantalla TV). */
    public String horaActual() {
        return DateTimeFormatter.ofPattern("HH:mm").withZone(Fechas.LIMA).format(reloj.instant());
    }

    /** Resalta *negritas* del texto de WhatsApp con &lt;b&gt;, escapando el resto. Se llama desde el controlador. */
    public String whatsapp(String mensaje) {
        if (mensaje == null) {
            return "";
        }
        String seguro = mensaje.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
        return seguro.replaceAll("\\*(.+?)\\*", "<b>$1</b>")
                .replaceAll("(https?://\\S+)", "<span class=\"enlace\">$1</span>");
    }
}
