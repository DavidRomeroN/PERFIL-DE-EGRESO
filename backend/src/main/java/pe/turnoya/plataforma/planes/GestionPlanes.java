package pe.turnoya.plataforma.planes;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.dominio.RepositorioPlanes;
import pe.turnoya.plataforma.dominio.RepositorioPlanes.DatosPlan;
import pe.turnoya.plataforma.dominio.RepositorioPlanes.PlanFila;

/**
 * N08 · catálogo de planes y su matriz de módulos (solo super admin). Mismas reglas que el sistema anterior: código
 * {@code A-Z0-9_} de 3 a 20, límites positivos y no se elimina un plan que algún local usa ({@code PLAN_EN_USO}).
 */
@Service
public class GestionPlanes {

    private final RepositorioPlanes planes;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;

    GestionPlanes(RepositorioPlanes planes, ModulosLocal modulos, Auditoria auditoria) {
        this.planes = planes;
        this.modulos = modulos;
        this.auditoria = auditoria;
    }

    public List<PlanFila> listar() {
        return planes.todos();
    }

    @Transactional
    public PlanFila crear(Formulario f, Auditoria.Actor actor) {
        DatosPlan d = f.validado();
        if (planes.existeCodigo(d.codigo(), null)) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un plan con el código " + d.codigo());
        }
        auditoria.fijarActor(actor);
        int id = planes.crear(d);
        modulos.invalidarTodo();
        auditoria.registrar(actor, null, "PLAN_CREAR", "plan", id, "Creó el plan " + d.nombre(), Map.of("codigo", d.codigo()));
        return exigir(id);
    }

    @Transactional
    public PlanFila editar(int id, Formulario f, Auditoria.Actor actor) {
        exigir(id);
        DatosPlan d = f.validado();
        if (planes.existeCodigo(d.codigo(), id)) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un plan con el código " + d.codigo());
        }
        auditoria.fijarActor(actor);
        planes.editar(id, d);
        modulos.invalidarTodo();
        auditoria.registrar(actor, null, "PLAN_EDITAR", "plan", id, "Editó el plan " + d.nombre(), d);
        return exigir(id);
    }

    @Transactional
    public void eliminar(int id, Auditoria.Actor actor) {
        PlanFila p = exigir(id);
        int enUso = planes.localesCon(id);
        if (enUso > 0) {
            throw ErrorNegocio.conflicto("PLAN_EN_USO", "El plan tiene " + enUso + (enUso == 1 ? " local" : " locales"));
        }
        auditoria.fijarActor(actor);
        planes.eliminar(id);
        modulos.invalidarTodo();
        auditoria.registrar(actor, null, "PLAN_ELIMINAR", "plan", id, "Eliminó el plan " + p.nombre(), null);
    }

    private PlanFila exigir(int id) {
        return planes.porId(id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Plan no encontrado"));
    }

    /** Datos del formulario o del cuerpo JSON ({@code modulos}: códigos M1–M8). */
    public record Formulario(String codigo, String nombre, BigDecimal precioMensual, Integer maxTurnosMes, Integer maxColas,
                             Integer maxVentanillas, Boolean whatsappHabilitado, Integer maxAvisosWhatsapp, Boolean reportes,
                             String descripcion, Collection<String> modulos) {

        DatosPlan validado() {
            String c = codigo == null ? "" : codigo.trim().toUpperCase(Locale.ROOT);
            if (!c.matches("^[A-Z0-9_]{3,20}$")) {
                throw invalido("Código: de 3 a 20 caracteres en mayúsculas, números o guion bajo");
            }
            String n = nombre == null ? "" : nombre.trim();
            if (n.length() < 2 || n.length() > 40) {
                throw invalido("Nombre: entre 2 y 40 caracteres");
            }
            if (precioMensual == null || precioMensual.signum() < 0 || precioMensual.compareTo(BigDecimal.valueOf(100_000)) > 0) {
                throw invalido("Precio mensual: entre 0 y 100 000");
            }
            int turnos = positivo(maxTurnosMes, "Turnos por mes");
            int colas = positivo(maxColas, "Colas");
            int ventanillas = positivo(maxVentanillas, "Ventanillas");
            int avisos = maxAvisosWhatsapp == null ? 0 : maxAvisosWhatsapp;
            if (avisos < 0) {
                throw invalido("Avisos de WhatsApp: 0 o más");
            }
            String desc = descripcion == null || descripcion.isBlank() ? null : descripcion.trim();
            if (desc != null && desc.length() > 200) {
                throw invalido("Descripción: hasta 200 caracteres");
            }
            Set<Modulo> mods = EnumSet.noneOf(Modulo.class);
            if (modulos != null) {
                for (String m : modulos) {
                    try {
                        mods.add(Modulo.valueOf(m.trim()));
                    } catch (IllegalArgumentException e) {
                        throw invalido("Módulo desconocido: " + m);
                    }
                }
            }
            return new DatosPlan(c, n, precioMensual, turnos, colas, ventanillas, Boolean.TRUE.equals(whatsappHabilitado), avisos,
                    Boolean.TRUE.equals(reportes), desc, mods);
        }

        private static int positivo(Integer valor, String campo) {
            if (valor == null || valor <= 0) {
                throw invalido(campo + ": debe ser mayor que 0");
            }
            return valor;
        }

        private static ErrorNegocio invalido(String mensaje) {
            return new ErrorNegocio("VALIDACION", mensaje, 422);
        }
    }
}
