package pe.turnoya.prioridades.politica;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.OrigenCategoria;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad;
import pe.turnoya.plataforma.LocalCreado;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades.CategoriaFila;

/**
 * Implementación de M1 del puerto {@link PoliticaPrioridad}: valida la categoría pedida antes de emitir. El cliente
 * solo declara categorías visibles; {@code CITA} solo la asigna el check-in. Con M1 apagado el núcleo no la consulta.
 */
@Component
class PoliticaPrioridadM1 implements PoliticaPrioridad {

    private final RepositorioPrioridades prioridades;
    private final ModulosLocal modulos;

    PoliticaPrioridadM1(RepositorioPrioridades prioridades, ModulosLocal modulos) {
        this.prioridades = prioridades;
        this.modulos = modulos;
    }

    @Override
    public boolean aplica(int localId) {
        return modulos.activo(localId, Modulo.M1);
    }

    @Override
    public Optional<CategoriaAsignada> resolver(int localId, String codigo, OrigenCategoria origen) {
        String cod = codigo == null || codigo.isBlank() ? "GENERAL" : codigo.trim().toUpperCase(Locale.ROOT);
        if (cod.equals("GENERAL")) {
            // El turno general siempre se puede tomar, por cualquier canal (aunque la fila se haya editado a mano)
            return Optional.empty();
        }
        Optional<CategoriaFila> cat = prioridades.activaPorCodigo(localId, cod);
        CategoriaFila c = cat.orElseThrow(() -> ErrorNegocio.noEncontrado("M1_CATEGORIA_INVALIDA", "La categoría no existe"));
        if (cod.equals("CITA") && origen != OrigenCategoria.CITA) {
            throw ErrorNegocio.conflicto("M1_CATEGORIA_NO_DISPONIBLE", "Categoría reservada para citas");
        }
        if (origen == OrigenCategoria.CLIENTE && !c.visibleCliente()) {
            throw ErrorNegocio.conflicto("M1_CATEGORIA_NO_DISPONIBLE", "Esa categoría solo la asigna el personal");
        }
        return Optional.of(new CategoriaAsignada(c.id(), c.codigo()));
    }

    @Override
    public List<CategoriaCliente> categoriasParaCliente(int localId) {
        return prioridades.categorias(localId).stream()
                .filter(c -> c.activa() && c.visibleCliente() && !c.codigo().equals("GENERAL") && !c.codigo().equals("CITA"))
                .map(c -> new CategoriaCliente(c.codigo(), c.nombre(), c.icono(), c.documento()))
                .toList();
    }

    /** Un local nuevo nace con las categorías y parámetros por defecto (en la misma transacción del alta). */
    @EventListener
    void alCrearLocal(LocalCreado evento) {
        prioridades.sembrar(evento.localId());
    }
}
