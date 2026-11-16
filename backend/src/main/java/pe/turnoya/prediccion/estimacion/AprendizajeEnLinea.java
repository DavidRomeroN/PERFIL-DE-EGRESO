package pe.turnoya.prediccion.estimacion;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.nucleo.eventos.TurnoEmitido;
import pe.turnoya.nucleo.eventos.TurnoLlamado;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prediccion.dominio.ModelosEspera;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;

/**
 * Monitoreo y aprendizaje en línea (RF-M2-08): al emitir guarda la predicción mostrada, al llamar completa la espera
 * real (y ESTACIONAL aprende φ) y al cerrar una atención actualiza el tiempo de servicio. Corre después del commit.
 */
@Component
class AprendizajeEnLinea {

    private static final Logger log = LoggerFactory.getLogger(AprendizajeEnLinea.class);

    private final RepositorioPrediccion repositorio;
    private final ModelosActivos modelos;
    private final EstimadorM2 estimador;
    private final ModulosLocal modulos;

    AprendizajeEnLinea(RepositorioPrediccion repositorio, ModelosActivos modelos, EstimadorM2 estimador, ModulosLocal modulos) {
        this.repositorio = repositorio;
        this.modelos = modelos;
        this.estimador = estimador;
        this.modulos = modulos;
    }

    @ApplicationModuleListener
    void alEmitir(TurnoEmitido e) {
        if (!modulos.activo(e.localId(), Modulo.M2)) {
            return;
        }
        try {
            repositorio.turno(e.turnoId()).ifPresent(t -> {
                int delante = t.delanteEmision() == null ? 0 : t.delanteEmision();
                var p = estimador.predecir(t.colaId(), delante, t.emitidoAt());
                repositorio.registrarPrediccion(t.id(), t.colaId(), ModelosEspera.Tipo.valueOf(p.modelo()), p.version(), delante, p.c(),
                        p.segundos(), p.loSeg(), p.hiSeg());
            });
        } catch (RuntimeException ex) {
            log.warn("M2: no se registró la predicción del turno {}: {}", e.turnoId(), ex.getMessage());
        }
    }

    @ApplicationModuleListener
    void alLlamar(TurnoLlamado e) {
        if (e.rellamada() || !modulos.activo(e.localId(), Modulo.M2)) {
            return;
        }
        repositorio.turno(e.turnoId()).filter(t -> t.llamadoAt() != null).ifPresent(t -> {
            var registro = repositorio.log(t.id()).filter(l -> l.realSeg() == null);
            if (registro.isEmpty()) {
                return;
            }
            int real = (int) Math.round((t.llamadoAt().toEpochMilli() - t.emitidoAt().toEpochMilli()) / 1000.0);
            repositorio.completarReal(t.id(), real);
            var m = modelos.de(t.colaId());
            if (m.estado().tipo == ModelosEspera.Tipo.ESTACIONAL && m.id() != null) {
                var f = modelos.franja(t.localId(), t.emitidoAt());
                var l = registro.get();
                synchronized (m.estado()) {
                    ModelosEspera.actualizarPhi(m.estado(), real, ModelosEspera.estructural(m.estado(), l.delante(), l.c(), f.dow(), f.franja()),
                            f.dow(), f.franja());
                    repositorio.actualizarParametros(m.id(), m.estado());
                }
            }
        });
    }

    @ApplicationModuleListener
    void alCerrar(TurnoCerrado e) {
        if (e.estado() != EstadoTurno.ATENDIDO || !modulos.activo(e.localId(), Modulo.M2)) {
            return;
        }
        repositorio.turno(e.turnoId()).filter(t -> t.llamadoAt() != null && t.finalizadoAt() != null).ifPresent(t -> {
            var m = modelos.de(t.colaId());
            var f = modelos.franja(t.localId(), t.llamadoAt());
            synchronized (m.estado()) {
                ModelosEspera.actualizarServicio(m.estado(), (t.finalizadoAt().toEpochMilli() - t.llamadoAt().toEpochMilli()) / 1000.0, f.dow(),
                        f.franja());
                if (m.id() != null) {
                    repositorio.actualizarParametros(m.id(), m.estado());
                }
            }
        });
    }
}
