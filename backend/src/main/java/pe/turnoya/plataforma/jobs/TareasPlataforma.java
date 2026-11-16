package pe.turnoya.plataforma.jobs;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.PlanificadorTareas;
import pe.turnoya.compartido.tareas.PlanificadorTareas.EstadoTarea;
import pe.turnoya.plataforma.Auditoria;

/** F1 · estado de las tareas programadas y "ejecutar ahora" (solo super admin). */
@Service
public class TareasPlataforma {

    private final PlanificadorTareas planificador;
    private final Auditoria auditoria;
    private final TransactionTemplate transaccion;

    TareasPlataforma(PlanificadorTareas planificador, Auditoria auditoria, TransactionTemplate transaccion) {
        this.planificador = planificador;
        this.auditoria = auditoria;
        this.transaccion = transaccion;
    }

    public List<EstadoTarea> estado() {
        return planificador.estado();
    }

    /** Ejecuta la tarea en este hilo y devuelve su resultado ({@code {omitida:true}} si ya estaba corriendo). */
    public Object ejecutar(String nombre, Auditoria.Actor actor) {
        if (!planificador.existe(nombre)) {
            throw ErrorNegocio.noEncontrado("NO_ENCONTRADO", "El job no existe");
        }
        transaccion.executeWithoutResult(s -> {
            auditoria.fijarActor(actor);
            auditoria.registrar(actor, null, "JOB_EJECUTAR", "job", nombre, "Ejecutó el job " + nombre, null);
        });
        Object resultado = planificador.ejecutarAhora(nombre);
        return resultado == null ? Map.of() : resultado;
    }
}
