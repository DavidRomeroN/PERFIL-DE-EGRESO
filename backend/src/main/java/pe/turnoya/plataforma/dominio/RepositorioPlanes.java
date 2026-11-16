package pe.turnoya.plataforma.dominio;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import pe.turnoya.plataforma.Modulo;

/** Puerto de salida: catálogo de planes y su matriz de módulos ({@code plan}, {@code plan_modulo}). Lo implementa {@code infraestructura.PlanesJdbc}. */
public interface RepositorioPlanes {

    /** Todos los planes, del más barato al más caro, con sus módulos y cuántos locales los usan. */
    List<PlanFila> todos();

    Optional<PlanFila> porId(int id);

    boolean existeCodigo(String codigo, Integer excepto);

    int crear(DatosPlan datos);

    void editar(int id, DatosPlan datos);

    int localesCon(int id);

    void eliminar(int id);

    record DatosPlan(String codigo, String nombre, BigDecimal precioMensual, int maxTurnosMes, int maxColas, int maxVentanillas,
                     boolean whatsappHabilitado, int maxAvisosWhatsapp, boolean reportes, String descripcion, Set<Modulo> modulos) {
    }

    record PlanFila(int id, String codigo, String nombre, BigDecimal precioMensual, int maxTurnosMes, int maxColas, int maxVentanillas,
                    boolean whatsappHabilitado, int maxAvisosWhatsapp, boolean reportes, String descripcion, Set<Modulo> modulos,
                    int locales) {

        public boolean incluye(String codigo) {
            return modulos.stream().anyMatch(m -> m.name().equals(codigo));
        }
    }
}
