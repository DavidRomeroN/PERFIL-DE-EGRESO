package pe.turnoya.prioridades.verificacion;

import java.time.Clock;
import java.util.Map;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.OrigenCategoria;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.prioridades.dominio.ReglasPrioridad;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades.TurnoEspera;

/**
 * RF-M1-06/07 · en la ventanilla: por qué el siguiente es el siguiente, y verificar, rechazar (pasa a General conservando
 * su hora, RN-M1-04) o cambiar la categoría de un turno en espera.
 */
@Service
public class VerificacionPrioridad {

    public enum Accion { VERIFICAR, RECHAZAR, CAMBIAR }

    private final RepositorioPrioridades prioridades;
    private final PoliticaPrioridad politica;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    VerificacionPrioridad(RepositorioPrioridades prioridades, PoliticaPrioridad politica, CatalogoLocales locales, Auditoria auditoria,
                          ApplicationEventPublisher eventos, Clock reloj) {
        this.prioridades = prioridades;
        this.politica = politica;
        this.locales = locales;
        this.auditoria = auditoria;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    @Transactional
    public Map<String, Object> cambiar(int localId, int turnoId, Accion accion, String categoriaCodigo, Auditoria.Actor actor) {
        TurnoEspera t = prioridades.turno(localId, turnoId).orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        if (!t.estado().equals("EMITIDO") && !t.estado().equals("AVISADO")) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "Solo se cambia la prioridad de un turno en espera");
        }
        auditoria.fijarActor(actor);
        String antes = t.categoria() == null ? "GENERAL" : t.categoria().codigo();
        if (accion == Accion.VERIFICAR) {
            prioridades.verificar(t.id());
            auditoria.registrar(actor, localId, "PRIORIDAD_VERIFICAR", "turno", t.id(), "Verificó la prioridad de " + t.codigo(), null);
        } else {
            Integer nueva = null;
            String despues = "GENERAL";
            if (accion == Accion.CAMBIAR) {
                Optional<PoliticaPrioridad.CategoriaAsignada> cat = politica.resolver(localId, categoriaCodigo, OrigenCategoria.PERSONAL);
                nueva = cat.map(PoliticaPrioridad.CategoriaAsignada::id).orElse(null);
                despues = cat.map(PoliticaPrioridad.CategoriaAsignada::codigo).orElse("GENERAL");
            }
            prioridades.cambiarCategoria(localId, t.id(), nueva, accion != Accion.RECHAZAR);
            auditoria.registrar(actor, localId, accion == Accion.RECHAZAR ? "PRIORIDAD_RECHAZAR" : "PRIORIDAD_CAMBIAR", "turno", t.id(),
                    accion == Accion.RECHAZAR ? "Rechazó la prioridad de " + t.codigo() + " (pasa a General)"
                            : "Cambió la categoría de " + t.codigo() + " a " + despues,
                    Map.of("antes", antes, "despues", despues));
        }
        eventos.publishEvent(new ColaActualizada(localId, t.colaId()));
        TurnoEspera d = prioridades.turno(localId, t.id()).orElseThrow();
        Map<String, Object> r = new java.util.LinkedHashMap<>();
        r.put("id", d.id());
        r.put("categoria", d.categoria() == null ? "GENERAL" : d.categoria().codigo());
        r.put("prioridadVerificada", d.verificada());
        return r;
    }

    /** Explicación del puntaje del siguiente turno, o vacío si no hay nadie en espera. */
    public Optional<Explicacion> explicacionSiguiente(int localId, Integer colaId) {
        Local local = locales.exigir(localId);
        var cfg = prioridades.config(localId);
        return prioridades.siguiente(localId, Fechas.fechaLocal(local.zonaHoraria(), reloj.instant()), colaId).map(t -> {
            var e = ReglasPrioridad.explicarPuntaje(new ReglasPrioridad.TurnoRegla(String.valueOf(t.id()), t.emitidoAt().toEpochMilli(),
                    t.categoria() == null ? null : t.categoria().regla()), cfg, reloj.millis());
            return new Explicacion(t.id(), t.codigo(), t.categoria() == null ? "General" : t.categoria().nombre(), e.base(), e.antiguedad(),
                    e.minEspera(), e.total(), e.texto());
        });
    }

    public record Explicacion(int turnoId, String codigo, String categoria, double base, double antiguedad, long minEspera, double total, String texto) {
    }
}
