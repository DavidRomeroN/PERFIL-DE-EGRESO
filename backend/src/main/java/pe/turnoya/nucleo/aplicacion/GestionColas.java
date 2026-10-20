package pe.turnoya.nucleo.aplicacion;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
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

/** Administración de colas del local (RF08). Respeta el máximo de colas del plan (RN05). */
@Service
public class GestionColas {

    private final ColasJdbc colas;
    private final VentanillasJdbc ventanillas;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;

    GestionColas(ColasJdbc colas, VentanillasJdbc ventanillas, CatalogoLocales locales, Auditoria auditoria, ApplicationEventPublisher eventos) {
        this.colas = colas;
        this.ventanillas = ventanillas;
        this.locales = locales;
        this.auditoria = auditoria;
        this.eventos = eventos;
    }

    @Transactional(readOnly = true)
    public List<ColaAdmin> listar(int localId) {
        List<Ventanilla> vents = ventanillas.delLocal(localId);
        return colas.delLocal(localId).stream().map(c -> new ColaAdmin(c.id(), c.localId(), c.prefijo(), c.nombre(), c.descripcion(),
                        c.activa(), c.tiempoAtencionBase(), c.orden(),
                        vents.stream().filter(v -> Objects.equals(v.colaId(), c.id()))
                                .map(v -> new VentanillaDeCola(v.id(), v.nombre(), v.activa())).toList(),
                        Map.of("turnos", colas.contarTurnos(c.id()))))
                .toList();
    }

    @Transactional
    public Cola crear(int localId, DatosCola datos, Auditoria.Actor actor) {
        Local local = locales.exigir(localId);
        Plan plan = locales.planDe(local);
        if (colas.contar(localId) >= plan.maxColas()) {
            throw new ErrorNegocio("LIMITE_PLAN", "Tu plan " + plan.nombre() + " permite hasta " + plan.maxColas()
                    + " cola(s). Mejora tu plan para agregar más.", 402);
        }
        int id = conPrefijoUnico(() -> colas.crear(localId, datos.prefijo().toUpperCase(Locale.ROOT), datos.nombre().trim(),
                vacioANulo(datos.descripcion()), datos.tiempoAtencionBaseOPorDefecto(), datos.activa() == null || datos.activa(),
                datos.orden() == null ? 0 : datos.orden()));
        Cola cola = colas.porId(id).orElseThrow();
        auditoria.registrar(actor, localId, "CREAR", "cola", id, "Creó la cola " + cola.nombre(), datos);
        eventos.publishEvent(new ColaActualizada(localId, id));
        return cola;
    }

    @Transactional
    public Cola editar(int localId, int colaId, CambiosCola cambios, Auditoria.Actor actor) {
        Cola c = exigir(localId, colaId);
        Cola nueva = new Cola(c.id(), c.localId(),
                cambios.prefijo() != null ? cambios.prefijo().toUpperCase(Locale.ROOT) : c.prefijo(),
                cambios.nombre() != null ? cambios.nombre().trim() : c.nombre(),
                cambios.descripcion() != null ? cambios.descripcion().map(GestionColas::vacioANulo).orElse(null) : c.descripcion(),
                cambios.activa() != null ? cambios.activa() : c.activa(),
                cambios.tiempoAtencionBase() != null ? cambios.tiempoAtencionBase() : c.tiempoAtencionBase(),
                cambios.orden() != null ? cambios.orden() : c.orden());
        conPrefijoUnico(() -> {
            colas.actualizar(nueva);
            return nueva.id();
        });
        auditoria.registrar(actor, localId, "EDITAR", "cola", colaId, "Editó la cola " + nueva.nombre(), cambios);
        eventos.publishEvent(new ColaActualizada(localId, colaId));
        return nueva;
    }

    /** Con turnos en el historial la cola solo se desactiva (se conserva la trazabilidad). */
    @Transactional
    public Map<String, Object> eliminar(int localId, int colaId, Auditoria.Actor actor) {
        Cola c = exigir(localId, colaId);
        eventos.publishEvent(new ColaActualizada(localId, colaId));
        if (colas.contarTurnos(colaId) > 0) {
            Cola desactivada = new Cola(c.id(), c.localId(), c.prefijo(), c.nombre(), c.descripcion(), false, c.tiempoAtencionBase(), c.orden());
            colas.actualizar(desactivada);
            auditoria.registrar(actor, localId, "DESACTIVAR", "cola", colaId, "Desactivó la cola " + c.nombre(), null);
            return Map.of("desactivada", true, "cola", desactivada);
        }
        colas.eliminar(colaId);
        auditoria.registrar(actor, localId, "ELIMINAR", "cola", colaId, "Eliminó la cola " + c.nombre(), null);
        return Map.of("eliminada", true);
    }

    @Transactional(readOnly = true)
    public Cola exigir(int localId, int colaId) {
        return colas.porIdEnLocal(colaId, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Cola no encontrada"));
    }

    private static int conPrefijoUnico(java.util.function.IntSupplier operacion) {
        try {
            return operacion.getAsInt();
        } catch (DuplicateKeyException e) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe una cola con ese prefijo");
        }
    }

    private static String vacioANulo(String texto) {
        return texto == null || texto.isBlank() ? null : texto.trim();
    }

    /** Cola con sus ventanillas y la cantidad de turnos (mismo formato que legacy/: {@code _count.turnos}). */
    public record ColaAdmin(int id, int localId, String prefijo, String nombre, String descripcion, boolean activa, int tiempoAtencionBase,
                            int orden, List<VentanillaDeCola> ventanillas, @JsonProperty("_count") Map<String, Integer> conteo) {
    }

    public record VentanillaDeCola(int id, String nombre, boolean activa) {
    }

    public record DatosCola(
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9]{1,3}$", message = "Usa letras o números (A, B, LAB)") String prefijo,
            @NotBlank @Size(min = 2, max = 60, message = "Mínimo 2 caracteres") String nombre,
            @Size(max = 160) String descripcion,
            @Min(30) @Max(3600) Integer tiempoAtencionBase,
            Boolean activa,
            @Min(0) Integer orden) {

        int tiempoAtencionBaseOPorDefecto() {
            return tiempoAtencionBase == null ? 300 : tiempoAtencionBase;
        }
    }

    /** Cambios parciales: un campo ausente no se toca; {@code descripcion} presente pero vacía la borra. */
    public record CambiosCola(
            @Pattern(regexp = "^[A-Za-z0-9]{1,3}$", message = "Usa letras o números (A, B, LAB)") String prefijo,
            @Size(min = 2, max = 60, message = "Mínimo 2 caracteres") String nombre,
            Optional<@Size(max = 160) String> descripcion,
            @Min(30) @Max(3600) Integer tiempoAtencionBase,
            Boolean activa,
            @Min(0) Integer orden) {
    }
}
