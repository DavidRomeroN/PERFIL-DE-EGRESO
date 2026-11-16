package pe.turnoya.prediccion.entrenamiento;

import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion.Config;
import pe.turnoya.prediccion.estimacion.ModelosActivos;

/** Modelo (AUTO o fijo), α de la EMA, nivel de confianza del rango y días de entrenamiento del local. Auditado (§11). */
@Service
public class ConfiguracionPrediccion {

    private static final Set<String> MODELOS = Set.of("AUTO", "BASELINE", "EMA", "ESTACIONAL");

    private final RepositorioPrediccion repositorio;
    private final ModelosActivos modelos;
    private final Auditoria auditoria;

    ConfiguracionPrediccion(RepositorioPrediccion repositorio, ModelosActivos modelos, Auditoria auditoria) {
        this.repositorio = repositorio;
        this.modelos = modelos;
        this.auditoria = auditoria;
    }

    public Config leer(int localId) {
        return repositorio.config(localId);
    }

    @Transactional
    public Config guardar(int localId, Config c, Auditoria.Actor actor) {
        if (c.modelo() == null || !MODELOS.contains(c.modelo())) {
            throw new ErrorNegocio("VALIDACION", "Modelo: AUTO, BASELINE, EMA o ESTACIONAL", 422);
        }
        if (c.alfaEma() < 0.05 || c.alfaEma() > 0.5) {
            throw new ErrorNegocio("VALIDACION", "La memoria de la predicción no es válida", 422);
        }
        if (c.nivelConfianza() != 0.8 && c.nivelConfianza() != 0.9) {
            throw new ErrorNegocio("VALIDACION", "Nivel de confianza: 0,8 o 0,9", 422);
        }
        if (c.diasEntrenamiento() < 14 || c.diasEntrenamiento() > 180) {
            throw new ErrorNegocio("VALIDACION", "Días de entrenamiento: de 14 a 180", 422);
        }
        auditoria.fijarActor(actor);
        repositorio.guardarConfig(localId, c);
        modelos.invalidarTodo();
        auditoria.registrar(actor, localId, "PREDICCION_CONFIG", "config_prediccion", localId,
                "Configuró la predicción (" + c.modelo() + ", α=" + c.alfaEma() + ", " + Math.round(c.nivelConfianza() * 100) + " %)",
                Map.of("modelo", c.modelo(), "alfaEma", c.alfaEma(), "nivelConfianza", c.nivelConfianza(), "diasEntrenamiento", c.diasEntrenamiento()));
        return repositorio.config(localId);
    }
}
