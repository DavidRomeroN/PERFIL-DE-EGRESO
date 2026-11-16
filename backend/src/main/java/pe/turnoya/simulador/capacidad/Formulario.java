package pe.turnoya.simulador.capacidad;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;

/**
 * Parámetros de la página del simulador (todo viaja en la URL: un escenario se comparte copiando el enlace). Los
 * valores que faltan toman los del sistema anterior; los que están fuera de rango se rechazan con un mensaje claro.
 *
 * @param colaId    cola elegida para calibrar o validar
 * @param calibrada {@code true} = usar la curva de llegadas, las ventanillas y las atenciones reales de {@code colaId}
 */
public record Formulario(Double lambda, Double servicio, Double cv, Integer c, Double slaMin, Double objetivo, Double paciencia, Double noShow,
                  Integer replicas, Integer semilla, String apertura, String cierre, Double costoVentanilla, Double costoEspera,
                  Integer colaId, Boolean calibrada) {

    private static final Pattern HORA = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

    /** Completa los vacíos con los valores por defecto y valida los rangos. */
    Formulario normalizado() {
        Formulario f = new Formulario(o(lambda, 30.0), o(servicio, 5.0), o(cv, 0.6), o(c, 3), o(slaMin, 15.0), o(objetivo, 90.0), o(paciencia, 0.0),
                o(noShow, 8.0), o(replicas, 500), o(semilla, 2026), o(apertura, "08:00"), o(cierre, "17:00"), o(costoVentanilla, 12.5),
                o(costoEspera, 0.4), colaId, Boolean.TRUE.equals(calibrada) && colaId != null);
        f.validar();
        return f;
    }

    private void validar() {
        rango(lambda, 0, 2000, "Las llegadas por hora deben estar entre 0 y 2000");
        rango(servicio, 0.1, 240, "La atención media debe estar entre 0,1 y 240 minutos");
        rango(cv, 0, 5, "La variabilidad (CV) debe estar entre 0 y 5");
        rango(c, 1, 200, "Las ventanillas deben estar entre 1 y 200");
        rango(slaMin, 1, 240, "La espera máxima del SLA debe estar entre 1 y 240 minutos");
        rango(objetivo, 1, 100, "El objetivo del SLA debe estar entre 1 y 100 %");
        rango(paciencia, 0, 600, "La paciencia media debe estar entre 0 y 600 minutos");
        rango(noShow, 0, 90, "El porcentaje que no se presenta debe estar entre 0 y 90");
        rango(replicas, 1, 5000, "Las réplicas deben estar entre 1 y 5000");
        rango(costoVentanilla, 0, 10000, "El costo por ventanilla-hora no es válido");
        rango(costoEspera, 0, 1000, "El costo por minuto de espera no es válido");
        if (!HORA.matcher(apertura).matches() || !HORA.matcher(cierre).matches()) {
            throw invalido("Las horas van en formato HH:MM");
        }
        if (Fechas.minutosDe(cierre) <= Fechas.minutosDe(apertura)) {
            throw invalido("La hora de cierre debe ser posterior a la de apertura");
        }
    }

    /** Mismos parámetros con otro número de ventanillas (botones − y +). */
    public Formulario conVentanillas(int otras) {
        return new Formulario(lambda, servicio, cv, Math.max(1, Math.min(200, otras)), slaMin, objetivo, paciencia, noShow, replicas, semilla, apertura,
                cierre, costoVentanilla, costoEspera, colaId, calibrada);
    }

    Formulario sinCalibrar() {
        return new Formulario(lambda, servicio, cv, c, slaMin, objetivo, paciencia, noShow, replicas, semilla, apertura, cierre, costoVentanilla,
                costoEspera, colaId, false);
    }

    /** Toma los valores que salen del histórico de la cola. */
    Formulario calibradoCon(CalibracionCapacidad.Calibracion k) {
        return new Formulario(Math.round(k.lambdaMedia()) * 1.0, k.servicioMedia(), k.servicioCv(), k.ventanillasMedia(), slaMin, objetivo,
                k.pacienciaMedia() == null ? 0.0 : (double) Math.round(k.pacienciaMedia()), k.noShowP() == null ? 0.0 : (double) Math.round(k.noShowP() * 100),
                replicas, semilla, k.apertura(), k.cierre(), costoVentanilla, costoEspera, k.colaId(), true);
    }

    /** Valores en el orden de la URL (también se guardan así en los escenarios). */
    public Map<String, Object> comoMapa() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("lambda", lambda);
        m.put("servicio", servicio);
        m.put("cv", cv);
        m.put("c", c);
        m.put("slaMin", slaMin);
        m.put("objetivo", objetivo);
        m.put("paciencia", paciencia);
        m.put("noShow", noShow);
        m.put("replicas", replicas);
        m.put("semilla", semilla);
        m.put("apertura", apertura);
        m.put("cierre", cierre);
        m.put("costoVentanilla", costoVentanilla);
        m.put("costoEspera", costoEspera);
        if (colaId != null) {
            m.put("colaId", colaId);
        }
        if (Boolean.TRUE.equals(calibrada)) {
            m.put("calibrada", true);
        }
        return m;
    }

    static Formulario deMapa(Map<String, Object> m) {
        return new Formulario(dbl(m.get("lambda")), dbl(m.get("servicio")), dbl(m.get("cv")), ent(m.get("c")), dbl(m.get("slaMin")), dbl(m.get("objetivo")),
                dbl(m.get("paciencia")), dbl(m.get("noShow")), ent(m.get("replicas")), ent(m.get("semilla")), str(m.get("apertura")), str(m.get("cierre")),
                dbl(m.get("costoVentanilla")), dbl(m.get("costoEspera")), ent(m.get("colaId")), Boolean.TRUE.equals(m.get("calibrada")));
    }

    /** Parte de consulta de la URL ({@code lambda=30&servicio=5…}). */
    public String consulta() {
        return comoMapa().entrySet().stream()
                .map(e -> e.getKey() + "=" + URLEncoder.encode(texto(e.getValue()), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    private static String texto(Object v) {
        if (v instanceof Double d && d == Math.rint(d)) {
            return String.valueOf(d.longValue());
        }
        return String.valueOf(v);
    }

    private static void rango(Number v, double min, double max, String mensaje) {
        if (v == null || Double.isNaN(v.doubleValue()) || v.doubleValue() < min || v.doubleValue() > max) {
            throw invalido(mensaje);
        }
    }

    private static ErrorNegocio invalido(String mensaje) {
        return new ErrorNegocio("M8_PARAMETROS_INVALIDOS", mensaje, 422);
    }

    private static <T> T o(T v, T defecto) {
        return v == null || (v instanceof String s && s.isBlank()) ? defecto : v;
    }

    private static Double dbl(Object v) {
        return v instanceof Number n ? n.doubleValue() : null;
    }

    private static Integer ent(Object v) {
        return v instanceof Number n ? n.intValue() : null;
    }

    private static String str(Object v) {
        return v == null ? null : v.toString();
    }
}
