package pe.turnoya.simulador.dominio;

import java.util.ArrayList;
import java.util.List;

/**
 * Modelo analítico M/M/c (Erlang C), numéricamente estable. Las entradas van en clientes por hora y minutos de atención;
 * internamente se trabaja en clientes por minuto (RN-M8-02).
 */
public final class ErlangC {

    private ErlangC() {
    }

    public record Resultado(boolean estable, double ocupacion, double probabilidadEspera, Double esperaMin, Double sistemaMin, Double colaMedia) {
    }

    public record Fila(int c, double ocupacion, boolean estable, double probEspera, Double esperaMin, Double p90Min, double nivelServicio) {
    }

    /** Recursión de Erlang B: B₀ = 1, Bₖ = a·Bₖ₋₁ / (k + a·Bₖ₋₁). Estable hasta c = 200 y más. */
    public static double erlangB(double a, int c) {
        double b = 1;
        for (int k = 1; k <= c; k++) {
            b = a * b / (k + a * b);
        }
        return b;
    }

    /** C(c, a) = B_c / (1 − ρ(1 − B_c)), válido si ρ &lt; 1. */
    public static double probEspera(double a, int c) {
        double rho = a / c;
        if (rho >= 1) {
            return 1;
        }
        double b = erlangB(a, c);
        return b / (1 - rho * (1 - b));
    }

    public static Resultado calcular(double llegadasPorHora, double servicioMin, int servidores) {
        double lambda = llegadasPorHora / 60;
        double mu = 1 / Math.max(servicioMin, 1e-9);
        int c = Math.max(1, servidores);
        double a = lambda / mu;
        if (a >= c) {
            return new Resultado(false, a / c, 1, null, null, null);
        }
        double prob = probEspera(a, c);
        double wq = prob / (c * mu - lambda);
        return new Resultado(true, a / c, prob, wq, wq + 1 / mu, lambda * wq);
    }

    /** P(Wq &gt; t) = C·exp(−(cμ − λ)·t). */
    public static double probEsperaMayor(double llegadasPorHora, double servicioMin, int servidores, double tMin) {
        double lambda = llegadasPorHora / 60;
        double mu = 1 / Math.max(servicioMin, 1e-9);
        int c = Math.max(1, servidores);
        if (lambda >= c * mu) {
            return 1;
        }
        return probEspera(lambda / mu, c) * Math.exp(-(c * mu - lambda) * tMin);
    }

    /** Nivel de servicio SL(t) = 1 − P(Wq &gt; t). */
    public static double nivelServicio(double llegadasPorHora, double servicioMin, int servidores, double tMin) {
        return 1 - probEsperaMayor(llegadasPorHora, servicioMin, servidores, tMin);
    }

    /** Percentil q de la espera: t_q = max(0, ln(C/(1−q)) / (cμ − λ)); infinito si el sistema es inestable. */
    public static double percentilEspera(double llegadasPorHora, double servicioMin, int servidores, double q) {
        double lambda = llegadasPorHora / 60;
        double mu = 1 / Math.max(servicioMin, 1e-9);
        int c = Math.max(1, servidores);
        if (lambda >= c * mu) {
            return Double.POSITIVE_INFINITY;
        }
        double prob = probEspera(lambda / mu, c);
        return Math.max(0, Math.log(prob / (1 - q)) / (c * mu - lambda));
    }

    /** Mínimo de ventanillas que cumple el SLA: SL(t) ≥ objetivo y ocupación ≤ ρmáx (RF-M8-04). */
    public static int minimoServidores(double llegadasPorHora, double servicioMin, double esperaObjetivoMin, double objetivo, double rhoMax, int tope) {
        double a = llegadasPorHora / 60 * Math.max(servicioMin, 1e-9);
        for (int c = Math.max(1, (int) Math.floor(a) + 1); c <= tope; c++) {
            Resultado r = calcular(llegadasPorHora, servicioMin, c);
            if (r.estable() && nivelServicio(llegadasPorHora, servicioMin, c, esperaObjetivoMin) >= objetivo && r.ocupacion() <= rhoMax) {
                return c;
            }
        }
        return tope;
    }

    /** Tabla de comparación para c = desde…hasta (pestaña «Comparar»). */
    public static List<Fila> tabla(double llegadasPorHora, double servicioMin, double slaMin, int desde, int hasta) {
        List<Fila> filas = new ArrayList<>();
        for (int c = Math.max(1, desde); c <= hasta; c++) {
            Resultado r = calcular(llegadasPorHora, servicioMin, c);
            filas.add(new Fila(c, r.ocupacion(), r.estable(), r.probabilidadEspera(), r.esperaMin(),
                    r.estable() ? percentilEspera(llegadasPorHora, servicioMin, c, 0.9) : null,
                    r.estable() ? nivelServicio(llegadasPorHora, servicioMin, c, slaMin) : 0));
        }
        return filas;
    }
}
