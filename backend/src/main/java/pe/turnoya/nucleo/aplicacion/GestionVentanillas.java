package pe.turnoya.nucleo.aplicacion;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.infraestructura.ColasJdbc;
import pe.turnoya.nucleo.infraestructura.VentanillasJdbc;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/** Administración de ventanillas del local. Respeta el máximo de ventanillas del plan (RN05). */
@Service
public class GestionVentanillas {

    private final VentanillasJdbc ventanillas;
    private final ColasJdbc colas;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;

    GestionVentanillas(VentanillasJdbc ventanillas, ColasJdbc colas, CatalogoLocales locales, Auditoria auditoria,
                       ApplicationEventPublisher eventos) {
        this.ventanillas = ventanillas;
        this.colas = colas;
        this.locales = locales;
        this.auditoria = auditoria;
        this.eventos = eventos;
    }

    @Transactional(readOnly = true)
    public List<VentanillaAdmin> listar(int localId) {
        List<Cola> deLocal = colas.delLocal(localId);
        return ventanillas.delLocal(localId).stream().map(v -> new VentanillaAdmin(v.id(), v.localId(), v.nombre(), v.colaId(), v.activa(),
                        deLocal.stream().filter(c -> Objects.equals(c.id(), v.colaId())).findFirst()
                                .map(c -> new ColaDeVentanilla(c.id(), c.nombre(), c.prefijo())).orElse(null)))
                .toList();
    }

    @Transactional
    public Ventanilla crear(int localId, DatosVentanilla datos, Auditoria.Actor actor) {
        Local local = locales.exigir(localId);
        Plan plan = locales.planDe(local);
        if (ventanillas.contar(localId) >= plan.maxVentanillas()) {
            throw new ErrorNegocio("LIMITE_PLAN", "Tu plan " + plan.nombre() + " permite hasta " + plan.maxVentanillas() + " ventanilla(s).", 402);
        }
        validarCola(localId, datos.colaId());
        int id = ventanillas.crear(localId, datos.nombre().trim(), datos.colaId(), datos.activa() == null || datos.activa());
        Ventanilla v = ventanillas.porIdEnLocal(id, localId).orElseThrow();
        auditoria.registrar(actor, localId, "CREAR", "ventanilla", id, "Creó la ventanilla " + v.nombre(), datos);
        eventos.publishEvent(new ColaActualizada(localId, null));
        return v;
    }

    @Transactional
    public Ventanilla editar(int localId, int ventanillaId, CambiosVentanilla cambios, Auditoria.Actor actor) {
        Ventanilla v = exigir(localId, ventanillaId);
        Integer colaId = cambios.colaId() != null ? cambios.colaId().orElse(null) : v.colaId();
        validarCola(localId, colaId);
        Ventanilla nueva = new Ventanilla(v.id(), v.localId(), cambios.nombre() != null ? cambios.nombre().trim() : v.nombre(), colaId,
                cambios.activa() != null ? cambios.activa() : v.activa());
        ventanillas.actualizar(nueva);
        auditoria.registrar(actor, localId, "EDITAR", "ventanilla", ventanillaId, "Editó la ventanilla " + nueva.nombre(), cambios);
        eventos.publishEvent(new ColaActualizada(localId, null));
        return nueva;
    }

    @Transactional
    public Map<String, Object> eliminar(int localId, int ventanillaId, Auditoria.Actor actor) {
        Ventanilla v = exigir(localId, ventanillaId);
        eventos.publishEvent(new ColaActualizada(localId, null));
        if (ventanillas.contarTurnos(ventanillaId) > 0) {
            Ventanilla desactivada = new Ventanilla(v.id(), v.localId(), v.nombre(), v.colaId(), false);
            ventanillas.actualizar(desactivada);
            auditoria.registrar(actor, localId, "DESACTIVAR", "ventanilla", ventanillaId, "Desactivó la ventanilla " + v.nombre(), null);
            return Map.of("desactivada", true, "ventanilla", desactivada);
        }
        ventanillas.eliminar(ventanillaId);
        auditoria.registrar(actor, localId, "ELIMINAR", "ventanilla", ventanillaId, "Eliminó la ventanilla " + v.nombre(), null);
        return Map.of("eliminada", true);
    }

    @Transactional(readOnly = true)
    public Ventanilla exigir(int localId, int ventanillaId) {
        return ventanillas.porIdEnLocal(ventanillaId, localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Ventanilla no encontrada"));
    }

    private void validarCola(int localId, Integer colaId) {
        if (colaId != null && colas.porIdEnLocal(colaId, localId).isEmpty()) {
            throw new ErrorNegocio("VALIDACION", "La cola no pertenece a este local", 422);
        }
    }

    public record VentanillaAdmin(int id, int localId, String nombre, Integer colaId, boolean activa, ColaDeVentanilla cola) {
    }

    public record ColaDeVentanilla(int id, String nombre, String prefijo) {
    }

    public record DatosVentanilla(
            @NotBlank @Size(min = 2, max = 40, message = "Mínimo 2 caracteres") String nombre,
            @Positive Integer colaId,
            Boolean activa) {
    }

    /** {@code colaId} ausente = sin cambio; presente y nulo = atiende todas las colas. */
    public record CambiosVentanilla(
            @Size(min = 2, max = 40, message = "Mínimo 2 caracteres") String nombre,
            Optional<@Positive Integer> colaId,
            Boolean activa) {
    }
}
