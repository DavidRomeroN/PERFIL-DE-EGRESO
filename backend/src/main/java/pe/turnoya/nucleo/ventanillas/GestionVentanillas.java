package pe.turnoya.nucleo.ventanillas;

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
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.dominio.RepositorioVentanillas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/**
 * Administración de ventanillas del local. Respeta el máximo de ventanillas del plan (RN05). Regla simple: cada cola
 * tiene una sola ventanilla activa y cada ventanilla atiende una sola cola. Quién llama en cada ventanilla se decide
 * en Usuarios (un operador puede tener una, varias o todas).
 */
@Service
public class GestionVentanillas {

    private final RepositorioVentanillas ventanillas;
    private final RepositorioColas colas;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;

    GestionVentanillas(RepositorioVentanillas ventanillas, RepositorioColas colas, CatalogoLocales locales, Auditoria auditoria,
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
        boolean activa = datos.activa() == null || datos.activa();
        validarCola(localId, datos.colaId(), activa, null);
        int id = ventanillas.crear(localId, datos.nombre().trim(), datos.colaId(), activa);
        Ventanilla v = ventanillas.porIdEnLocal(id, localId).orElseThrow();
        auditoria.registrar(actor, localId, "CREAR", "ventanilla", id, "Creó la ventanilla " + v.nombre(), datos);
        eventos.publishEvent(new ColaActualizada(localId, null));
        return v;
    }

    @Transactional
    public Ventanilla editar(int localId, int ventanillaId, CambiosVentanilla cambios, Auditoria.Actor actor) {
        Ventanilla v = exigir(localId, ventanillaId);
        // Ausente (Jackson lo entrega como Optional vacío) = sin cambio: una ventanilla ya no puede quedarse sin cola
        Integer colaId = cambios.colaId() != null && cambios.colaId().isPresent() ? cambios.colaId().get() : v.colaId();
        boolean activa = cambios.activa() != null ? cambios.activa() : v.activa();
        validarCola(localId, colaId, activa, v.id());
        Ventanilla nueva = new Ventanilla(v.id(), v.localId(), cambios.nombre() != null ? cambios.nombre().trim() : v.nombre(), colaId, activa);
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

    /** Una ventanilla activa atiende exactamente una cola, y esa cola no puede tener otra ventanilla activa. */
    private void validarCola(int localId, Integer colaId, boolean activa, Integer exceptoId) {
        if (colaId == null) {
            if (activa) {
                throw new ErrorNegocio("VALIDACION", "Elige la cola que atiende esta ventanilla", 422);
            }
            return;
        }
        Cola cola = colas.porIdEnLocal(colaId, localId)
                .orElseThrow(() -> new ErrorNegocio("VALIDACION", "La cola no pertenece a este local", 422));
        if (activa) {
            ventanillas.activasDelLocal(localId).stream()
                    .filter(o -> Objects.equals(o.colaId(), colaId) && !Objects.equals(o.id(), exceptoId))
                    .findFirst()
                    .ifPresent(o -> {
                        throw ErrorNegocio.conflicto("COLA_CON_VENTANILLA", "La cola " + cola.nombre() + " ya tiene la ventanilla "
                                + o.nombre() + ". Cada cola tiene una sola ventanilla.");
                    });
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

    /** {@code colaId} ausente = sin cambio (ya no se admite una ventanilla activa sin cola). */
    public record CambiosVentanilla(
            @Size(min = 2, max = 40, message = "Mínimo 2 caracteres") String nombre,
            Optional<@Positive Integer> colaId,
            Boolean activa) {
    }
}
