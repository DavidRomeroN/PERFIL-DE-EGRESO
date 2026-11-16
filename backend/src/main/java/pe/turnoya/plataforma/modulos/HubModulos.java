package pe.turnoya.plataforma.modulos;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModuloCambiado;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.dominio.RepositorioModulos;

/** N03 · Hub de módulos: qué incluye el plan y el interruptor de cada módulo en el local. */
@Service
class HubModulos {

    private final RepositorioModulos modulos;
    private final ModulosLocal cache;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;

    HubModulos(RepositorioModulos modulos, ModulosLocal cache, CatalogoLocales locales, Auditoria auditoria, ApplicationEventPublisher eventos) {
        this.modulos = modulos;
        this.cache = cache;
        this.locales = locales;
        this.auditoria = auditoria;
        this.eventos = eventos;
    }

    List<EstadoModulo> estado(int localId) {
        Set<Modulo> incluidos = modulos.incluidos(localId);
        Set<Modulo> encendidos = modulos.encendidos(localId);
        return Arrays.stream(Modulo.values())
                .map(m -> new EstadoModulo(m.name(), m.nombre(), m.descripcion(), m.ruta(), incluidos.contains(m), incluidos.contains(m) && encendidos.contains(m)))
                .toList();
    }

    String nombrePlan(int localId) {
        return locales.planDe(locales.exigir(localId)).nombre();
    }

    @Transactional
    List<EstadoModulo> cambiar(int localId, String codigo, boolean habilitado, Auditoria.Actor actor) {
        Modulo modulo = Arrays.stream(Modulo.values()).filter(m -> m.name().equals(codigo)).findFirst()
                .orElseThrow(() -> ErrorNegocio.noEncontrado("VALIDACION", "Módulo desconocido"));
        if (habilitado && !modulos.incluidos(localId).contains(modulo)) {
            throw new ErrorNegocio("MODULO_NO_INCLUIDO", "El plan " + nombrePlan(localId) + " no incluye este módulo", 402);
        }
        auditoria.fijarActor(actor);
        modulos.cambiar(localId, modulo, habilitado);
        cache.invalidar(localId);
        auditoria.registrar(actor, localId, habilitado ? "MODULO_ACTIVAR" : "MODULO_DESACTIVAR", "local_modulo", codigo,
                (habilitado ? "Activó" : "Desactivó") + " el módulo " + codigo, null);
        eventos.publishEvent(new ModuloCambiado(localId, modulo, habilitado));
        return estado(localId);
    }

    record EstadoModulo(String codigo, String nombre, String descripcion, String ruta, boolean incluido, boolean habilitado) {
    }
}
