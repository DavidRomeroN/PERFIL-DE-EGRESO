package pe.turnoya.prioridades.configuracion;

import java.time.Clock;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.prioridades.dominio.ReglasPrioridad;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Config;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.Simulacion;
import pe.turnoya.prioridades.dominio.ReglasPrioridad.TurnoSimulado;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades.CategoriaFila;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades.DatosCategoria;

/**
 * M1 · administración: parámetros (α, tope, aging), categorías y vista previa (RF-M1-01…09). Cada cambio que afecta el
 * orden recalcula la clave de los turnos en espera de hoy (RN-M1-05) y avisa a las pantallas.
 */
@Service
public class GestionPrioridades {

    public static final List<String> DOCUMENTOS = List.of("NINGUNO", "DNI", "CARNE_GESTANTE", "CONADIS", "TRIAJE");

    /** Cola de ejemplo de la vista previa (la misma del sistema anterior). */
    public static final List<TurnoSimulado> EJEMPLO = List.of(
            new TurnoSimulado("A-030", "GENERAL", 38),
            new TurnoSimulado("A-031", "DISCAPACIDAD", 21),
            new TurnoSimulado("A-032", "GENERAL", 15),
            new TurnoSimulado("A-033", "GESTANTE", 9),
            new TurnoSimulado("A-034", "ADULTO_MAYOR", 3));

    private final RepositorioPrioridades prioridades;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    GestionPrioridades(RepositorioPrioridades prioridades, CatalogoLocales locales, Auditoria auditoria, ApplicationEventPublisher eventos, Clock reloj) {
        this.prioridades = prioridades;
        this.locales = locales;
        this.auditoria = auditoria;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    public Prioridades listar(int localId) {
        List<CategoriaFila> categorias = prioridades.categorias(localId);
        if (categorias.isEmpty()) {
            // Locales anteriores a M1: se siembran al abrir la configuración por primera vez
            prioridades.sembrar(localId);
            categorias = prioridades.categorias(localId);
        }
        return new Prioridades(prioridades.config(localId), categorias);
    }

    @Transactional
    public Map<String, Integer> guardarConfig(int localId, Config cfg, Auditoria.Actor actor) {
        if (cfg.alfa() < 0 || cfg.alfa() > 10 || cfg.tope() < 0 || cfg.tope() > 10) {
            throw new ErrorNegocio("VALIDACION", "Las reglas no son válidas: el tiempo de espera va de 0 a 10 y el máximo seguido de 0 a 10", 422);
        }
        auditoria.fijarActor(actor);
        prioridades.guardarConfig(localId, cfg);
        int n = recalcular(localId);
        auditoria.registrar(actor, localId, "PRIORIDAD_CONFIG", "config_prioridad", localId,
                "Cambió α=" + cfg.alfa() + ", tope=" + cfg.tope() + ", aging=" + (cfg.aging() ? "sí" : "no"),
                Map.of("alfa", cfg.alfa(), "tope", cfg.tope(), "aging", cfg.aging(), "recalculados", n));
        return Map.of("recalculados", n);
    }

    @Transactional
    public CategoriaFila crear(int localId, NuevaCategoria n, Auditoria.Actor actor) {
        DatosCategoria d = n.validada();
        if (d.activa()) {
            validarLimite(localId, null);
        }
        auditoria.fijarActor(actor);
        try {
            CategoriaFila c = prioridades.crear(localId, d);
            auditoria.registrar(actor, localId, "CATEGORIA_CREAR", "categoria_prioridad", c.id(), "Creó la categoría " + c.nombre(), null);
            return c;
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe una categoría con ese nombre (" + d.codigo() + "): usa otro");
        }
    }

    @Transactional
    public CategoriaFila editar(int localId, int id, CambioCategoria cambio, Auditoria.Actor actor) {
        CategoriaFila c = exigir(localId, id);
        if (c.codigo().equals("GENERAL") && (Boolean.FALSE.equals(cambio.activa()) || Boolean.FALSE.equals(cambio.visibleCliente())
                || (cambio.pesoBase() != null && cambio.pesoBase() != 0)
                || Boolean.TRUE.equals(cambio.absoluta()))) {
            throw ErrorNegocio.conflicto("M1_NO_ELIMINAR_GENERAL", "La categoría General siempre existe, con peso 0 y disponible para todos");
        }
        if (cambio.pesoBase() != null && (cambio.pesoBase() < 0 || cambio.pesoBase() > 1000)) {
            throw new ErrorNegocio("M1_PESO_FUERA_DE_RANGO", "La ventaja va de 0 a 1000", 422);
        }
        if (Boolean.TRUE.equals(cambio.activa()) && !c.activa()) {
            validarLimite(localId, id);
        }
        DatosCategoria d = cambio.aplicadoA(c);
        auditoria.fijarActor(actor);
        CategoriaFila nueva = prioridades.editar(id, d);
        if (cambio.pesoBase() != null || cambio.absoluta() != null || cambio.activa() != null) {
            recalcular(localId);
        }
        auditoria.registrar(actor, localId, "CATEGORIA_EDITAR", "categoria_prioridad", id, "Editó la categoría " + nueva.nombre(), cambio);
        return nueva;
    }

    /** Borrado lógico si la categoría tiene turnos, físico si no. GENERAL no se elimina. */
    @Transactional
    public Map<String, Boolean> eliminar(int localId, int id, Auditoria.Actor actor) {
        CategoriaFila c = exigir(localId, id);
        if (c.codigo().equals("GENERAL")) {
            throw ErrorNegocio.conflicto("M1_NO_ELIMINAR_GENERAL", "La categoría General no se puede eliminar");
        }
        boolean logico = prioridades.turnosConCategoria(id) > 0;
        auditoria.fijarActor(actor);
        if (logico) {
            prioridades.desactivar(id);
        } else {
            prioridades.eliminar(id);
        }
        recalcular(localId);
        auditoria.registrar(actor, localId, "CATEGORIA_ELIMINAR", "categoria_prioridad", id, "Eliminó la categoría " + c.nombre(), null);
        return Map.of("borradoLogico", logico);
    }

    /** Orden FIFO frente al priorizado de una cola hipotética, con parámetros y pesos aún sin guardar (RF-M1-09). */
    public Simulacion simular(int localId, Config cfg, List<TurnoSimulado> turnos, Map<String, Integer> pesos) {
        Config c = cfg != null ? cfg : prioridades.config(localId);
        List<TurnoSimulado> cola = turnos == null || turnos.isEmpty() ? EJEMPLO : turnos;
        if (cola.size() > 50) {
            throw new ErrorNegocio("VALIDACION", "Máximo 50 turnos", 422);
        }
        var categorias = prioridades.categorias(localId).stream().filter(CategoriaFila::activa)
                .map(x -> new ReglasPrioridad.Categoria(x.codigo(), pesos != null && pesos.get(x.codigo()) != null ? pesos.get(x.codigo()) : x.pesoBase(), x.absoluta()))
                .toList();
        return ReglasPrioridad.simular(cola, categorias, c, reloj.millis());
    }

    private int recalcular(int localId) {
        Local local = locales.exigir(localId);
        int n = prioridades.recalcular(localId, Fechas.fechaLocal(local.zonaHoraria(), reloj.instant()));
        eventos.publishEvent(new ColaActualizada(localId, null));
        return n;
    }

    private void validarLimite(int localId, Integer excepto) {
        Local local = locales.exigir(localId);
        if (!"EMPRENDE".equals(locales.planDe(local).codigo())) {
            return;
        }
        if (prioridades.preferentesActivas(localId, excepto) >= 4) {
            throw new ErrorNegocio("M1_LIMITE_CATEGORIAS", "El plan Emprende permite hasta 4 categorías preferentes activas", 402);
        }
    }

    private CategoriaFila exigir(int localId, int id) {
        return prioridades.categoria(localId, id).orElseThrow(() -> ErrorNegocio.noEncontrado("M1_CATEGORIA_INVALIDA", "La categoría no existe"));
    }

    public record Prioridades(Config config, List<CategoriaFila> categorias) {
    }

    /** Cuerpo de {@code POST /api/v1/prioridades/categorias}. */
    public record NuevaCategoria(String codigo, String nombre, String icono, Integer pesoBase, Boolean absoluta, String documento, Integer esperaMaxSeg,
                                 Boolean visibleCliente, Boolean activa, Integer orden) {

        DatosCategoria validada() {
            String c = codigo == null ? "" : codigo.trim().toUpperCase(Locale.ROOT);
            if (!c.matches("^[A-Z0-9_]{2,16}$")) {
                throw new ErrorNegocio("VALIDACION", "Código: usa mayúsculas, números o _ (2–16)", 422);
            }
            String n = nombre == null ? "" : nombre.trim();
            if (n.length() < 2 || n.length() > 60) {
                throw new ErrorNegocio("VALIDACION", "Nombre: entre 2 y 60 caracteres", 422);
            }
            int peso = pesoBase == null ? 0 : pesoBase;
            if (peso < 0 || peso > 1000) {
                throw new ErrorNegocio("M1_PESO_FUERA_DE_RANGO", "La ventaja va de 0 a 1000", 422);
            }
            String doc = documento == null || documento.isBlank() ? "NINGUNO" : documento;
            if (!DOCUMENTOS.contains(doc)) {
                throw new ErrorNegocio("VALIDACION", "Documento inválido", 422);
            }
            if (esperaMaxSeg != null && (esperaMaxSeg < 0 || esperaMaxSeg > 14_400)) {
                throw new ErrorNegocio("VALIDACION", "Espera máxima: de 0 a 14 400 s", 422);
            }
            int ord = orden == null ? 10 : orden;
            return new DatosCategoria(c, n, icono == null || icono.isBlank() ? null : icono.trim(), peso, Boolean.TRUE.equals(absoluta), doc, esperaMaxSeg,
                    visibleCliente == null || visibleCliente, activa == null || activa, Math.max(0, Math.min(100, ord)));
        }
    }

    /** Cuerpo de {@code PATCH /api/v1/prioridades/categorias/{id}}: solo los campos presentes cambian. */
    public record CambioCategoria(String nombre, String icono, Integer pesoBase, Boolean absoluta, String documento, Integer esperaMaxSeg,
                                  Boolean visibleCliente, Boolean activa, Integer orden) {

        DatosCategoria aplicadoA(CategoriaFila c) {
            String n = nombre == null ? c.nombre() : nombre.trim();
            if (n.length() < 2 || n.length() > 60) {
                throw new ErrorNegocio("VALIDACION", "Nombre: entre 2 y 60 caracteres", 422);
            }
            String doc = documento == null ? c.documento() : documento;
            if (!DOCUMENTOS.contains(doc)) {
                throw new ErrorNegocio("VALIDACION", "Documento inválido", 422);
            }
            return new DatosCategoria(c.codigo(), n, icono == null ? c.icono() : icono, pesoBase == null ? c.pesoBase() : pesoBase,
                    absoluta == null ? c.absoluta() : absoluta, doc, esperaMaxSeg == null ? c.esperaMaxSeg() : esperaMaxSeg,
                    visibleCliente == null ? c.visibleCliente() : visibleCliente, activa == null ? c.activa() : activa,
                    orden == null ? c.orden() : Math.max(0, Math.min(100, orden)));
        }

    }
}
