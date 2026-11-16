package pe.turnoya.balanceo.reglas;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import pe.turnoya.balanceo.dominio.ReglasBalanceo.MetricasLocal;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.CatalogoLocales;

/** §6.2 Métricas del local en una sola consulta (por cola y del local) y el mapa de carga por ventanilla. */
@Service
public class MetricasBalanceo {

    private final RepositorioBalanceo repositorio;
    private final CatalogoLocales locales;
    private final Clock reloj;

    MetricasBalanceo(RepositorioBalanceo repositorio, CatalogoLocales locales, Clock reloj) {
        this.repositorio = repositorio;
        this.locales = locales;
        this.reloj = reloj;
    }

    /** Métricas de una cola, con los nombres de campo del contrato anterior. */
    public record MetricasCola(int colaId, String cola, int en_espera, double espera_max_min, double espera_prom_min, int ventanillas_operativas,
                               int ventanillas_libres, double utilizacion, int tasa_llegada_15m, int ventanillas_activas) {

        public int utilizacionPct() {
            return (int) Math.round(utilizacion * 100);
        }
    }

    public record Calculo(MetricasLocal metricas, List<MetricasCola> detalle) {
    }

    public record Carga(List<MetricasCola> colas, List<RepositorioBalanceo.VentanillaCarga> ventanillas, Map<String, Double> local) {
    }

    LocalDate hoy(int localId) {
        return Fechas.fechaLocal(locales.exigir(localId).zonaHoraria(), reloj.instant());
    }

    public Calculo calcular(int localId) {
        Instant ahora = reloj.instant();
        var filas = repositorio.carga(localId, hoy(localId), ahora);
        Map<Integer, Map<String, Double>> colas = new LinkedHashMap<>();
        List<MetricasCola> detalle = new ArrayList<>();
        List<Double> proms = new ArrayList<>();
        for (var r : filas) {
            int operativas = Math.max(r.operativas(), 0);
            int libres = Math.max(0, operativas - r.ocupadas());
            double util = operativas == 0 ? 0 : Math.round((1 - (double) libres / operativas) * 100) / 100.0;
            double max = redondear(r.esperaMaxMin());
            double prom = redondear(r.esperaPromMin());
            if (r.esperaPromMin() != null && r.esperaPromMin() > 0) {
                proms.add(r.esperaPromMin());
            }
            var m = new MetricasCola(r.colaId(), r.nombre(), r.enEspera(), max, prom, operativas, libres, util, r.llegadas(), r.ventanillasActivas());
            Map<String, Double> valores = new LinkedHashMap<>();
            valores.put("en_espera", (double) m.en_espera());
            valores.put("espera_max_min", max);
            valores.put("espera_prom_min", prom);
            valores.put("ventanillas_operativas", (double) operativas);
            valores.put("ventanillas_libres", (double) libres);
            valores.put("utilizacion", util);
            valores.put("tasa_llegada_15m", (double) r.llegadas());
            colas.put(r.colaId(), valores);
            detalle.add(m);
        }
        double local = proms.isEmpty() ? 0 : redondear(proms.stream().mapToDouble(Double::doubleValue).average().orElse(0));
        return new Calculo(new MetricasLocal(colas, local), detalle);
    }

    /** {@code GET /balanceo/carga}: por cola y por ventanilla. */
    public Carga carga(int localId) {
        Calculo c = calcular(localId);
        return new Carga(c.detalle(), repositorio.ventanillas(localId, hoy(localId)), Map.of("espera_prom_local", c.metricas().esperaPromLocal()));
    }

    private static double redondear(Double v) {
        return v == null ? 0 : Math.round(v * 10) / 10.0;
    }
}
