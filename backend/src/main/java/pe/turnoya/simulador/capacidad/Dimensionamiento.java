package pe.turnoya.simulador.capacidad;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.simulador.dominio.ErlangC;
import pe.turnoya.simulador.dominio.ParametrosSimulacion;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.Tramo;
import pe.turnoya.simulador.dominio.ParametrosSimulacion.TramoVentanillas;
import pe.turnoya.simulador.dominio.RepositorioSimulador;
import pe.turnoya.simulador.dominio.SimulacionEventos;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Casos de uso del simulador: resultado analítico, simulación, sensibilidad y escenarios guardados. */
@Service
public class Dimensionamiento {

    static final int MAX_ESCENARIOS = 20;
    static final double OCUPACION_MAXIMA = 0.85;
    private static final int REPLICAS_SENSIBILIDAD = 200;

    private final RepositorioSimulador repositorio;
    private final CalibracionCapacidad calibracion;
    private final Auditoria auditoria;
    private final ObjectMapper json;

    Dimensionamiento(RepositorioSimulador repositorio, CalibracionCapacidad calibracion, Auditoria auditoria, ObjectMapper json) {
        this.repositorio = repositorio;
        this.calibracion = calibracion;
        this.auditoria = auditoria;
        this.json = json;
    }

    public record Analitico(ErlangC.Resultado erlang, double nivelServicio, Double p90, int minimo, boolean cumple) {
    }

    Analitico analitico(Formulario f) {
        var r = ErlangC.calcular(f.lambda(), f.servicio(), f.c());
        double sl = r.estable() ? ErlangC.nivelServicio(f.lambda(), f.servicio(), f.c(), f.slaMin()) : 0;
        double p90 = r.estable() ? ErlangC.percentilEspera(f.lambda(), f.servicio(), f.c(), 0.9) : Double.POSITIVE_INFINITY;
        int minimo = ErlangC.minimoServidores(f.lambda(), f.servicio(), f.slaMin(), f.objetivo() / 100, OCUPACION_MAXIMA, 200);
        return new Analitico(r, sl, Double.isInfinite(p90) ? null : p90, minimo, r.estable() && sl * 100 >= f.objetivo());
    }

    List<ErlangC.Fila> comparacion(Formulario f, int minimo) {
        return ErlangC.tabla(f.lambda(), f.servicio(), f.slaMin(), Math.max(1, minimo - 2), minimo + 3);
    }

    /** Arma el día simulado: constante con los valores del formulario o, si está calibrado, con la curva real de la cola. */
    ParametrosSimulacion parametros(int localId, Formulario f, CalibracionCapacidad.Calibracion k) {
        List<Tramo> lambda = k != null ? k.lambdaPorHora() : List.of(new Tramo(f.apertura(), f.lambda()));
        var servicio = k != null
                ? new ParametrosSimulacion.Servicio(ParametrosSimulacion.TipoServicio.EMPIRICA, f.servicio(), f.cv(), k.muestras())
                : new ParametrosSimulacion.Servicio(ParametrosSimulacion.TipoServicio.LOGNORMAL, f.servicio(), f.cv(), List.of());
        // Con la curva real se usan las ventanillas reales salvo que el admin cambie la cantidad
        List<TramoVentanillas> ventanillas = k != null && f.c() == k.ventanillasMedia() ? k.ventanillas() : List.of(new TramoVentanillas(f.apertura(), f.c()));
        String apertura = k != null ? k.apertura() : f.apertura();
        String cierre = k != null ? k.cierre() : f.cierre();
        return new ParametrosSimulacion(apertura, cierre, lambda, servicio, ventanillas, f.paciencia() > 0 ? f.paciencia() : null,
                f.noShow() > 0 ? new ParametrosSimulacion.NoShow(f.noShow() / 100, 3) : null, f.slaMin(), f.objetivo(),
                new ParametrosSimulacion.Costos(f.costoVentanilla(), f.costoEspera()), f.replicas(), f.semilla());
    }

    CalibracionCapacidad.Calibracion calibracionDe(int localId, Formulario f) {
        return Boolean.TRUE.equals(f.calibrada()) && f.colaId() != null ? calibracion.calibrar(localId, f.colaId()) : null;
    }

    SimulacionEventos.MonteCarlo simular(ParametrosSimulacion p) {
        return SimulacionEventos.monteCarlo(p);
    }

    List<SimulacionEventos.Factor> sensibilidad(ParametrosSimulacion p) {
        return SimulacionEventos.tornado(p, Math.min(REPLICAS_SENSIBILIDAD, p.replicas()));
    }

    // --- Escenarios guardados ---

    List<RepositorioSimulador.Escenario> escenarios(int localId) {
        return repositorio.escenarios(localId);
    }

    @Transactional
    public int guardar(Auditoria.Actor actor, int localId, String nombre, Formulario f, SimulacionEventos.MonteCarlo resultado) {
        String n = nombre == null ? "" : nombre.trim();
        if (n.isEmpty()) {
            n = f.c() + " ventanillas · " + Math.round(f.lambda()) + " llegadas/h";
        }
        if (n.length() > 80) {
            throw new ErrorNegocio("M8_PARAMETROS_INVALIDOS", "El nombre puede tener hasta 80 caracteres", 422);
        }
        if (repositorio.contarEscenarios(localId) >= MAX_ESCENARIOS) {
            throw new ErrorNegocio("M8_LIMITE_ESCENARIOS", "Puedes guardar hasta " + MAX_ESCENARIOS + " escenarios: elimina uno para guardar otro.", 409);
        }
        if (f.colaId() != null && repositorio.cola(localId, f.colaId()).isEmpty()) {
            throw ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe");
        }
        Map<String, Object> resultados = null;
        if (resultado != null) {
            resultados = new LinkedHashMap<>();
            resultados.put("pctSla", resultado.pctSla().media());
            resultados.put("esperaMedia", resultado.esperaMedia().media());
            resultados.put("motor", SimulacionEventos.VERSION_MOTOR);
        }
        auditoria.fijarActor(actor);
        int id = repositorio.crearEscenario(localId, n, f.colaId(), json.writeValueAsString(f.comoMapa()),
                resultados == null ? null : json.writeValueAsString(resultados), f.semilla(), actor.usuarioId());
        auditoria.registrar(actor, localId, "ESCENARIO_GUARDAR", "escenario_simulacion", id, "Guardó el escenario «" + n + "» del simulador", null);
        return id;
    }

    Formulario abrir(int localId, int id) {
        var e = repositorio.escenario(localId, id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El escenario no existe"));
        Map<String, Object> m = json.readValue(e.parametrosJson(), new TypeReference<Map<String, Object>>() {
        });
        return Formulario.deMapa(m);
    }

    @Transactional
    public void eliminar(Auditoria.Actor actor, int localId, int id) {
        var e = repositorio.escenario(localId, id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El escenario no existe"));
        auditoria.fijarActor(actor);
        repositorio.eliminarEscenario(localId, id);
        auditoria.registrar(actor, localId, "ESCENARIO_ELIMINAR", "escenario_simulacion", id, "Eliminó el escenario «" + e.nombre() + "» del simulador", null);
    }
}
