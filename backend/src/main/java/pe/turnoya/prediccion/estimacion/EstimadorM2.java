package pe.turnoya.prediccion.estimacion;

import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.puertos.EstimadorEspera;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prediccion.dominio.ModelosEspera;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;

/**
 * RF-M2-01 · Espera con rango ("14–22 min") para quien tiene {@code k} personas delante. Reemplaza la estimación por
 * promedio del núcleo en los locales con M2.
 */
@Service
public class EstimadorM2 implements EstimadorEspera {

    private final ModelosActivos modelos;
    private final RepositorioPrediccion repositorio;
    private final ModulosLocal modulos;
    private final Clock reloj;

    EstimadorM2(ModelosActivos modelos, RepositorioPrediccion repositorio, ModulosLocal modulos, Clock reloj) {
        this.modelos = modelos;
        this.repositorio = repositorio;
        this.modulos = modulos;
        this.reloj = reloj;
    }

    @Override
    public boolean aplica(int localId) {
        return modulos.activo(localId, Modulo.M2);
    }

    @Override
    public Estimacion estimar(int colaId, int posicion) {
        Prediccion p = predecir(colaId, Math.max(0, posicion - 1), reloj.instant());
        return new Estimacion(p.segundos(), new Rango(p.loSeg(), p.hiSeg(), p.confianza(), p.modelo(), p.enFrio()));
    }

    public Prediccion predecir(int colaId, int delante, Instant ahora) {
        var cola = repositorio.cola(colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        var m = modelos.de(colaId);
        var cfg = repositorio.config(cola.localId());
        int c = modelos.ventanillasOperativas(colaId, ahora);
        var f = modelos.franja(cola.localId(), ahora);
        double pred = ModelosEspera.predecir(m.estado(), delante, c, f.dow(), f.franja());
        var iv = ModelosEspera.intervalo(m.estado(), pred, f.franja());
        return new Prediccion((int) Math.round(pred), (int) Math.round(iv.lo()), (int) Math.round(iv.hi()), cfg.nivelConfianza(),
                m.estado().tipo.name(), m.id() == null || m.estado().nServicios < 30, c, m.version());
    }

    public record Prediccion(int segundos, int loSeg, int hiSeg, double confianza, String modelo, boolean enFrio, int c, int version) {
    }
}
