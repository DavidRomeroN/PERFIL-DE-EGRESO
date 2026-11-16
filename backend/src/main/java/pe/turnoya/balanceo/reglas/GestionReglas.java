package pe.turnoya.balanceo.reglas;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.balanceo.dominio.Accion;
import pe.turnoya.balanceo.dominio.Condicion;
import pe.turnoya.balanceo.dominio.ReglasBalanceo;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo.Regla;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.databind.ObjectMapper;

/** Reglas de balanceo: CRUD, validación (condición, recursos del local y contradicciones) y "probar ahora". */
@Service
public class GestionReglas {

    public static final Map<String, String> METRICAS = new java.util.LinkedHashMap<>();

    static {
        METRICAS.put("espera_prom_min", "Espera promedio (min)");
        METRICAS.put("espera_max_min", "Espera máxima (min)");
        METRICAS.put("en_espera", "Personas en espera");
        METRICAS.put("utilizacion", "Utilización (0–1)");
        METRICAS.put("tasa_llegada_15m", "Llegadas en 15 min");
        METRICAS.put("ventanillas_libres", "Ventanillas libres");
        METRICAS.put("ventanillas_operativas", "Ventanillas operativas");
        METRICAS.put("espera_prom_local", "Espera promedio del local (min)");
        METRICAS.put("sla_cumplimiento", "Cumplimiento del SLA (%)");
    }

    private final RepositorioBalanceo repositorio;
    private final MetricasBalanceo metricas;
    private final ModulosLocal modulos;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;
    private final ObjectMapper json;

    GestionReglas(RepositorioBalanceo repositorio, MetricasBalanceo metricas, ModulosLocal modulos, CatalogoLocales locales, Auditoria auditoria,
                  ObjectMapper json) {
        this.repositorio = repositorio;
        this.metricas = metricas;
        this.modulos = modulos;
        this.locales = locales;
        this.auditoria = auditoria;
        this.json = json;
    }

    /** Datos que llegan de la API o del formulario. Los nulos se completan con los valores por defecto (o los actuales al editar). */
    public record Entrada(String nombre, Object condicion, Object accion, Integer forSegundos, Integer forSegundosReversa, Integer cooldownSeg,
                          Integer histeresisPct, Integer ttlSeg, Boolean requiereConfirmacion, Integer prioridad) {
    }

    public record VistaEstado(String fase, java.time.Instant verdaderaDesde, java.time.Instant ultimaEjecucionAt) {
    }

    public record VistaRegla(int id, String nombre, boolean activa, String modo, Object condicion, Object accion, int forSegundos, int forSegundosReversa,
                             int cooldownSeg, int histeresisPct, Integer ttlSeg, boolean requiereConfirmacion, int prioridad, VistaEstado estado,
                             String descripcion) {
    }

    public record Validacion(boolean valida, List<String> avisos) {
    }

    public record Prueba(boolean cumpleAhora, String haria, List<MetricasBalanceo.MetricasCola> metricas) {
    }

    /** Regla ya interpretada (para el evaluador). */
    record Interpretada(Regla regla, Condicion condicion, Accion accion) {
    }

    public List<VistaRegla> listar(int localId) {
        modulos.exigir(localId, Modulo.M6);
        Map<Integer, String> colas = repositorio.colas(localId);
        Map<Integer, String> vents = repositorio.nombresVentanillas(localId);
        return repositorio.reglas(localId).stream().map(r -> vista(r, colas, vents)).toList();
    }

    public Validacion validar(int localId, Entrada e, Integer id) {
        modulos.exigir(localId, Modulo.M6);
        return validar(localId, completar(e, null), id);
    }

    @Transactional
    public VistaRegla crear(Auditoria.Actor actor, int localId, Entrada e) {
        modulos.exigir(localId, Modulo.M6);
        String plan = locales.planDe(locales.exigir(localId)).codigo();
        if ("EMPRENDE".equals(plan) || "GRATIS".equals(plan)) {
            throw new ErrorNegocio("M6_LIMITE_REGLAS", "Las reglas automáticas son del plan Pro (en Emprende hay transferencia manual)", 402);
        }
        if (repositorio.contarReglas(localId) >= 20) {
            throw new ErrorNegocio("M6_LIMITE_REGLAS", "Máximo 20 reglas por local", 402);
        }
        var d = completar(e, null);
        validar(localId, d, null);
        auditoria.fijarActor(actor);
        int id = repositorio.crear(localId, d, actor.usuarioId());
        auditoria.registrar(actor, localId, "REGLA_CREAR", "regla_balanceo", id, "Creó la regla \"" + d.nombre() + "\" (simulación)", null);
        return vistaDe(localId, id);
    }

    /** Editar, activar (modo ACTIVA, auditado), pasar a simulación o apagar. */
    @Transactional
    public VistaRegla editar(Auditoria.Actor actor, int localId, int id, Entrada e, Boolean activa, String modo) {
        modulos.exigir(localId, Modulo.M6);
        Regla r = exigir(localId, id);
        if (modo != null && !Set.of("SIMULACION", "ACTIVA").contains(modo)) {
            throw new ErrorNegocio("VALIDACION", "Modo inválido", 422);
        }
        var d = completar(e == null ? new Entrada(null, null, null, null, null, null, null, null, null, null) : e, r);
        boolean nuevaActiva = activa != null ? activa : r.activa();
        if (nuevaActiva) {
            validar(localId, d, id);
        }
        auditoria.fijarActor(actor);
        repositorio.actualizar(id, d, nuevaActiva, modo != null ? modo : r.modo());
        if (!nuevaActiva) {
            repositorio.borrarEstado(id);
        }
        boolean activando = "ACTIVA".equals(modo) && !"ACTIVA".equals(r.modo());
        auditoria.registrar(actor, localId, activando ? "REGLA_ACTIVAR" : "REGLA_EDITAR", "regla_balanceo", id,
                activando ? "Activó la regla \"" + d.nombre() + "\"" : "Editó la regla \"" + d.nombre() + "\"", null);
        return vistaDe(localId, id);
    }

    Regla exigir(int localId, int id) {
        return repositorio.regla(id, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "La regla no existe"));
    }

    /** {@code POST /balanceo/reglas/{id}/probar}: qué haría con las métricas actuales. */
    public Prueba probar(int localId, int id) {
        modulos.exigir(localId, Modulo.M6);
        Interpretada r = interpretar(exigir(localId, id));
        var calculo = metricas.calcular(localId);
        boolean cumple = ReglasBalanceo.evaluar(r.condicion(), calculo.metricas());
        String haria = cumple
                ? "Habría decidido " + ReglasBalanceo.describirAccion(r.accion(), repositorio.colas(localId), repositorio.nombresVentanillas(localId))
                        + " (tras " + r.regla().forSegundos() + " s sostenidos)"
                : "No haría nada con la carga actual";
        return new Prueba(cumple, haria, calculo.detalle());
    }

    Interpretada interpretar(Regla r) {
        return new Interpretada(r, Condicion.desde(json.readValue(r.condicionJson(), Object.class)), Accion.desde(json.readValue(r.accionJson(), Object.class)));
    }

    // --- Validación ---

    private Validacion validar(int localId, RepositorioBalanceo.DatosRegla d, Integer id) {
        Condicion cond;
        Accion acc;
        try {
            cond = Condicion.desde(json.readValue(d.condicionJson(), Object.class));
        } catch (RuntimeException ex) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La condición no es válida", 422);
        }
        try {
            acc = Accion.desde(json.readValue(d.accionJson(), Object.class));
        } catch (RuntimeException ex) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La acción no es válida", 422);
        }
        if (ReglasBalanceo.condicionImposible(cond)) {
            throw new ErrorNegocio("M6_CONDICION_IMPOSIBLE", "La condición nunca puede cumplirse", 422);
        }
        Set<Integer> colas = repositorio.colas(localId).keySet();
        List<Integer> usadas = new ArrayList<>(cond.colas());
        usadas.addAll(acc.colas());
        if (usadas.stream().anyMatch(c -> !colas.contains(c))) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La regla usa colas de otro local", 422);
        }
        if (acc instanceof Accion.MoverOperador m && m.desdeColaId() == m.haciaColaId()) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "Elige colas distintas para mover la ventanilla", 422);
        }
        if (acc.ventanilla() != null && !repositorio.nombresVentanillas(localId).containsKey(acc.ventanilla())) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "La ventanilla no es de este local", 422);
        }
        List<ReglasBalanceo.ReglaDef> otras = repositorio.activas(localId).stream()
                .map(o -> new ReglasBalanceo.ReglaDef(o.id(), Accion.desde(json.readValue(o.accionJson(), Object.class)), o.forSegundos(), o.cooldownSeg(),
                        o.activa()))
                .toList();
        Integer choque = ReglasBalanceo.reglasContradictorias(new ReglasBalanceo.ReglaDef(id == null ? -1 : id, acc, d.forSegundos(), d.cooldownSeg(), true),
                otras);
        if (choque != null) {
            throw new ErrorNegocio("M6_REGLAS_CONTRADICTORIAS", "Contradice a la regla #" + choque + ": moverían el mismo operador en sentidos opuestos",
                    409, Map.of("reglaId", choque));
        }
        return new Validacion(true, d.histeresisPct() < 5 ? List.of("Histéresis menor a 5 %: la regla puede oscilar") : List.of());
    }

    private RepositorioBalanceo.DatosRegla completar(Entrada e, Regla actual) {
        String nombre = e.nombre() != null ? e.nombre().trim() : actual != null ? actual.nombre() : null;
        if (nombre == null || nombre.length() < 3 || nombre.length() > 80) {
            throw new ErrorNegocio("VALIDACION", "El nombre debe tener de 3 a 80 caracteres", 422);
        }
        String cond = e.condicion() != null ? json.writeValueAsString(e.condicion()) : actual != null ? actual.condicionJson() : null;
        String acc = e.accion() != null ? json.writeValueAsString(e.accion()) : actual != null ? actual.accionJson() : null;
        if (cond == null || acc == null) {
            throw new ErrorNegocio("M6_CONDICION_INVALIDA", "Indica la condición y la acción", 422);
        }
        int forSeg = rango(e.forSegundos(), actual != null ? actual.forSegundos() : 300, 0, 3600, "La duración");
        int forRev = rango(e.forSegundosReversa(), actual != null ? actual.forSegundosReversa() : 300, 0, 3600, "La duración de reversa");
        int cooldown = rango(e.cooldownSeg(), actual != null ? actual.cooldownSeg() : 600, 120, 86400, "El enfriamiento");
        int hist = rango(e.histeresisPct(), actual != null ? actual.histeresisPct() : 20, 0, 80, "La histéresis");
        Integer ttl = e.ttlSeg() != null ? Integer.valueOf(rango(e.ttlSeg(), 0, 60, 86400, "El TTL")) : actual != null ? actual.ttlSeg() : null;
        boolean conf = e.requiereConfirmacion() != null ? e.requiereConfirmacion() : actual != null && actual.requiereConfirmacion();
        int prio = rango(e.prioridad(), actual != null ? actual.prioridad() : 100, 1, 1000, "La prioridad");
        return new RepositorioBalanceo.DatosRegla(nombre, cond, acc, forSeg, forRev, cooldown, hist, ttl, conf, prio);
    }

    private static int rango(Integer v, int defecto, int min, int max, String campo) {
        int x = v == null ? defecto : v;
        if (x < min || x > max) {
            throw new ErrorNegocio("VALIDACION", campo + " debe estar entre " + min + " y " + max, 422);
        }
        return x;
    }

    // --- Vistas ---

    private VistaRegla vistaDe(int localId, int id) {
        return vista(exigir(localId, id), repositorio.colas(localId), repositorio.nombresVentanillas(localId));
    }

    private VistaRegla vista(Regla r, Map<Integer, String> colas, Map<Integer, String> vents) {
        Object cond = json.readValue(r.condicionJson(), Object.class);
        Object acc = json.readValue(r.accionJson(), Object.class);
        String descripcion;
        try {
            Condicion c = Condicion.desde(cond);
            Accion a = Accion.desde(acc);
            descripcion = "Si " + describir(c, colas) + " durante " + Math.round(r.forSegundos() / 60.0) + " min ⇒ "
                    + ReglasBalanceo.describirAccion(a, colas, vents);
        } catch (RuntimeException e) {
            descripcion = "Regla con formato no reconocido";
        }
        var e = r.estado() == null ? null : new VistaEstado(r.estado().fase(), r.estado().verdaderaDesde(), r.estado().ultimaEjecucionAt());
        return new VistaRegla(r.id(), r.nombre(), r.activa(), r.modo(), cond, acc, r.forSegundos(), r.forSegundosReversa(), r.cooldownSeg(),
                r.histeresisPct(), r.ttlSeg(), r.requiereConfirmacion(), r.prioridad(), e, descripcion);
    }

    static String describir(Condicion c, Map<Integer, String> colas) {
        return switch (c) {
            case Condicion.Todas t -> String.join(" y ", t.condiciones().stream().map(x -> describir(x, colas)).toList());
            case Condicion.Alguna a -> "(" + String.join(" o ", a.condiciones().stream().map(x -> describir(x, colas)).toList()) + ")";
            case Condicion.Negacion n -> "no (" + describir(n.condicion(), colas) + ")";
            case Condicion.Comparacion x -> METRICAS.getOrDefault(x.metrica(), x.metrica()).toLowerCase() + " " + x.op() + " "
                    + (x.valor() == Math.floor(x.valor()) ? String.valueOf((long) x.valor()) : String.valueOf(x.valor()))
                    + (x.cola() != null ? " en " + colas.getOrDefault(x.cola(), "#" + x.cola()) : "");
        };
    }
}
