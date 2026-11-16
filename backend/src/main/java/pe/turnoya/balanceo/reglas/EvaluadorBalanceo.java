package pe.turnoya.balanceo.reglas;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import pe.turnoya.balanceo.AlertaBalanceo;
import pe.turnoya.balanceo.dominio.Accion;
import pe.turnoya.balanceo.dominio.ReglasBalanceo;
import pe.turnoya.balanceo.dominio.ReglasBalanceo.Decision;
import pe.turnoya.balanceo.dominio.ReglasBalanceo.EstadoRegla;
import pe.turnoya.balanceo.dominio.ReglasBalanceo.Fase;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo.Regla;
import pe.turnoya.balanceo.transferencias.Transferencias;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.eventos.EventoPantalla;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.databind.ObjectMapper;

/**
 * §6.4 Evaluador de reglas (cada 30 s, solo locales con M6 y reglas activas, con candado por local), ejecutor y
 * reversión de acciones, confirmaciones pendientes, "Balancear ahora" y borrado de reglas (revierte si estaba activa).
 */
@Service
public class EvaluadorBalanceo {

    private static final Logger log = LoggerFactory.getLogger(EvaluadorBalanceo.class);

    private final RepositorioBalanceo repositorio;
    private final GestionReglas reglas;
    private final MetricasBalanceo metricas;
    private final Transferencias transferencias;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;
    private final MeterRegistry medidor;
    private final ObjectMapper json;
    private final Clock reloj;
    private final TransactionTemplate transaccion;
    private final TransactionTemplate transaccionNueva;

    EvaluadorBalanceo(RepositorioBalanceo repositorio, GestionReglas reglas, MetricasBalanceo metricas, Transferencias transferencias, ModulosLocal modulos,
                      Auditoria auditoria, ApplicationEventPublisher eventos, MeterRegistry medidor, ObjectMapper json, Clock reloj,
                      PlatformTransactionManager tx) {
        this.repositorio = repositorio;
        this.reglas = reglas;
        this.metricas = metricas;
        this.transferencias = transferencias;
        this.modulos = modulos;
        this.auditoria = auditoria;
        this.eventos = eventos;
        this.medidor = medidor;
        this.json = json;
        this.reloj = reloj;
        this.transaccion = new TransactionTemplate(tx);
        this.transaccion.setTimeout(60);
        this.transaccionNueva = new TransactionTemplate(tx);
        this.transaccionNueva.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Job {@code balanceo-evaluar}: cada local con reglas activas, en su propia transacción con candado consultivo. */
    public String job() {
        int evaluados = 0;
        for (int localId : repositorio.localesConReglasActivas()) {
            if (!modulos.activo(localId, Modulo.M6)) {
                continue;
            }
            try {
                Boolean ok = transaccion.execute(s -> {
                    if (!repositorio.candado(localId)) {
                        return false;
                    }
                    evaluarLocal(localId);
                    return true;
                });
                if (Boolean.TRUE.equals(ok)) {
                    evaluados++;
                }
            } catch (RuntimeException e) {
                log.warn("Balanceo del local {} falló: {}", localId, e.getMessage());
            }
        }
        return "evaluados=" + evaluados;
    }

    /** Job {@code balanceo-limpiar}: ejecuciones de más de 90 días. */
    public String limpiar() {
        return "eliminadas=" + repositorio.borrarEjecucionesAntesDe(reloj.instant().minus(Duration.ofDays(90)));
    }

    /** Un ciclo del evaluador para un local. Llamar con el candado tomado (dentro de una transacción). */
    void evaluarLocal(int localId) {
        long t0 = System.nanoTime();
        List<Regla> activas = repositorio.activas(localId);
        if (activas.isEmpty()) {
            return;
        }
        Instant ahora = reloj.instant();
        long ahoraMs = ahora.toEpochMilli();
        var calculo = metricas.calcular(localId);
        String resumen = json.writeValueAsString(calculo.detalle());
        Map<Integer, String> colas = repositorio.colas(localId);
        Map<Integer, String> vents = repositorio.nombresVentanillas(localId);
        for (Regla r : activas) {
            GestionReglas.Interpretada ri;
            try {
                ri = reglas.interpretar(r);
            } catch (RuntimeException e) {
                continue;
            }
            Accion accion = ri.accion();
            boolean cond = ReglasBalanceo.evaluar(ri.condicion(), calculo.metricas());
            boolean salida = ReglasBalanceo.evaluar(ReglasBalanceo.condicionSalida(ri.condicion(), r.histeresisPct()), calculo.metricas());
            Map<String, Object> estadoAccion = leer(r.estado() == null ? null : r.estado().estadoAccionJson());
            EstadoRegla previo = r.estado() == null ? EstadoRegla.INICIAL
                    : new EstadoRegla(fase(r.estado().fase()), ms(r.estado().verdaderaDesde()), ms(r.estado().falsaDesde()), ms(r.estado().ultimaEjecucionAt()),
                            estadoAccion != null && estadoAccion.get("ejecutadaMs") instanceof Number n ? n.longValue() : null);
            boolean reversible = ReglasBalanceo.esReversible(accion) && "ACTIVA".equals(r.modo()) && !r.requiereConfirmacion();
            var paso = ReglasBalanceo.avanzar(previo, cond, salida, ahoraMs,
                    new ReglasBalanceo.ConfigEvaluador(r.forSegundos(), r.forSegundosReversa(), r.cooldownSeg(), r.ttlSeg(), reversible));
            EstadoRegla estado = paso.estado();
            Fase fase = estado.fase();

            if (paso.decision() == Decision.OMITIDA_COOLDOWN) {
                registrar(r.id(), localId, "DISPARO", resumen, "OMITIDA_COOLDOWN", null);
            }
            if (paso.decision() == Decision.EJECUTAR) {
                int ultimaHora = repositorio.ejecutadasDesde(localId, ahora.minus(Duration.ofHours(1)));
                String descripcion = ReglasBalanceo.describirAccion(accion, colas, vents);
                if ("SIMULACION".equals(r.modo())) {
                    registrar(r.id(), localId, "SIMULACION", resumen, "SIMULADA", Map.of("habria", "Habría decidido " + descripcion));
                    fase = Fase.INACTIVA;
                } else if (ultimaHora >= ReglasBalanceo.MAX_ACCIONES_HORA) {
                    registrar(r.id(), localId, "DISPARO", resumen, "OMITIDA_LIMITE", null);
                    medidor.counter("m6_limite_total").increment();
                    eventos.publishEvent(new AlertaBalanceo(localId, "BALANCEO_LIMITE", "balanceo", "Límite de acciones automáticas por hora alcanzado", r.id()));
                    fase = Fase.INACTIVA;
                } else if (r.requiereConfirmacion()) {
                    registrar(r.id(), localId, "CONFIRMACION", resumen, "PENDIENTE_CONFIRMACION", Map.of("haria", descripcion));
                    fase = Fase.INACTIVA;
                } else {
                    try {
                        var res = ejecutar(localId, r.id(), accion);
                        estadoAccion = res.estadoAccion() == null ? null : conMarca(res.estadoAccion(), ahoraMs);
                        registrar(r.id(), localId, "DISPARO", resumen, "EJECUTADA", Map.of("detalle", res.detalle()));
                        if (res.estadoAccion() == null) {
                            fase = Fase.INACTIVA;
                        }
                    } catch (RuntimeException e) {
                        registrar(r.id(), localId, "DISPARO", resumen, "FALLIDA", Map.of("error", String.valueOf(e.getMessage())));
                        fase = Fase.INACTIVA;
                    }
                }
            }
            if (paso.decision() == Decision.REVERTIR) {
                revertir(localId, r.id(), accion, estadoAccion);
                registrar(r.id(), localId, "REVERSION", resumen, "EJECUTADA", Map.of("detalle", "Acción revertida"));
                estadoAccion = null;
            }
            repositorio.guardarEstado(r.id(), fase.name(), instante(estado.verdaderaDesdeMs()), instante(estado.falsaDesdeMs()),
                    instante(estado.ultimaEjecucionMs()), estadoAccion == null ? null : json.writeValueAsString(estadoAccion));
        }
        medidor.timer("m6_eval_ms").record(Duration.ofNanos(System.nanoTime() - t0));
        medidor.counter("m6_reglas_evaluadas_total").increment(activas.size());
    }

    record Resultado(Map<String, Object> estadoAccion, String detalle) {
    }

    private Resultado ejecutar(int localId, int reglaId, Accion a) {
        return switch (a) {
            case Accion.AbrirVentanilla x -> {
                var v = repositorio.ventanilla(x.ventanillaId(), localId)
                        .orElseThrow(() -> new ErrorNegocio("M6_SIN_RECURSO", "La ventanilla no existe", 409));
                repositorio.abrirVentanilla(v.id(), x.colaId(), v.colaId(), reglaId);
                eventos.publishEvent(new ColaActualizada(localId, null));
                Map<String, Object> e = new HashMap<>();
                e.put("ventanillaId", v.id());
                e.put("estabaActiva", v.activa());
                e.put("colaAnterior", v.colaId());
                yield new Resultado(e, "Abrió " + v.nombre());
            }
            case Accion.MoverOperador x -> {
                // Exclusión mutua por recurso (RN-M6-08): no se toca una ventanilla ya movida por otra regla
                var v = repositorio.ventanillaLibre(localId, x.desdeColaId(), x.ventanillaId(), true)
                        .orElseThrow(() -> new ErrorNegocio("M6_SIN_RECURSO", "No hay una ventanilla libre en la cola de origen", 409));
                repositorio.moverVentanilla(v.id(), x.haciaColaId(), x.desdeColaId(), reglaId);
                eventos.publishEvent(new ColaActualizada(localId, null));
                yield new Resultado(Map.of("ventanillaId", v.id(), "colaOriginal", x.desdeColaId()),
                        "Movió " + v.nombre() + " a " + repositorio.colas(localId).getOrDefault(x.haciaColaId(), "la cola " + x.haciaColaId()));
            }
            case Accion.DerivarTurnos x -> {
                int n = 0;
                for (int turnoId : repositorio.ultimosEnEspera(localId, x.deColaId(), x.cantidad())) {
                    try {
                        // Cada transferencia en su propia transacción: un turno ya llamado o con cliente en destino se omite
                        transaccionNueva.executeWithoutResult(s -> transferencias.transferir(Auditoria.Actor.SISTEMA, localId, turnoId,
                                new Transferencias.Solicitud(x.aColaId(), null, "BALANCEO", null, true, "REGLA", reglaId)));
                        n++;
                    } catch (RuntimeException e) {
                        log.debug("Turno {} no derivado: {}", turnoId, e.getMessage());
                    }
                }
                yield new Resultado(null, "Derivó " + n + " turnos");
            }
            case Accion.Notificar x -> {
                eventos.publishEvent(new AlertaBalanceo(localId, "COLA_LARGA", "regla:" + reglaId, x.mensaje(), reglaId));
                yield new Resultado(null, "Notificó al admin");
            }
            case Accion.AjustarAlfa x -> {
                double antes = repositorio.alfa(localId);
                double despues = Math.min(10, Math.max(0, antes + x.delta()));
                repositorio.fijarAlfa(localId, despues);
                repositorio.recalcularClaves(localId, metricas.hoy(localId));
                eventos.publishEvent(new ColaActualizada(localId, null));
                yield new Resultado(Map.of("alfaAntes", antes), "α " + antes + " → " + despues);
            }
        };
    }

    private void revertir(int localId, int reglaId, Accion a, Map<String, Object> ea) {
        if (ea == null) {
            return;
        }
        if (a instanceof Accion.MoverOperador && ea.get("ventanillaId") instanceof Number v && ea.get("colaOriginal") instanceof Number c) {
            repositorio.revertirMovimiento(v.intValue(), localId, reglaId, c.intValue());
        } else if (a instanceof Accion.AbrirVentanilla && ea.get("ventanillaId") instanceof Number v) {
            repositorio.revertirApertura(v.intValue(), localId, reglaId, Boolean.TRUE.equals(ea.get("estabaActiva")),
                    ea.get("colaAnterior") instanceof Number c ? c.intValue() : null);
        } else if (a instanceof Accion.AjustarAlfa && ea.get("alfaAntes") instanceof Number alfa) {
            repositorio.fijarAlfa(localId, alfa.doubleValue());
            repositorio.recalcularClaves(localId, metricas.hoy(localId));
        }
        eventos.publishEvent(new ColaActualizada(localId, null));
        medidor.counter("m6_reversiones_total").increment();
    }

    private void registrar(int reglaId, int localId, String fase, String metricasJson, String resultado, Map<String, ?> detalle) {
        repositorio.registrarEjecucion(reglaId, localId, fase, metricasJson, resultado, detalle == null ? null : json.writeValueAsString(detalle));
        medidor.counter("m6_disparos_total", "resultado", resultado).increment();
        eventos.publishEvent(new EventoPantalla("balanceo:accion", localId, Map.of("reglaId", reglaId, "resultado", resultado)));
    }

    // --- Confirmaciones, historial, borrado y balanceo manual ---

    public record Ejecuciones(List<VistaEjecucion> items, String cursor) {
    }

    public record VistaEjecucion(String id, int reglaId, String regla, Instant ts, String fase, String resultado, Map<String, Object> detalle,
                                 Integer confirmadaPor) {

        public String textoDetalle() {
            return detalle == null ? "" : String.join(" ", detalle.values().stream().map(String::valueOf).toList());
        }
    }

    public Ejecuciones ejecuciones(int localId, Integer reglaId, String resultado, Long cursor) {
        modulos.exigir(localId, Modulo.M6);
        var filas = repositorio.ejecuciones(localId, reglaId, resultado == null || resultado.isBlank() ? null : resultado, cursor, 50);
        var items = filas.stream().map(f -> new VistaEjecucion(String.valueOf(f.id()), f.reglaId(), f.regla(), f.ts(), f.fase(), f.resultado(),
                leer(f.detalleJson()), f.confirmadaPor())).toList();
        return new Ejecuciones(items, filas.size() == 50 ? String.valueOf(filas.getLast().id()) : null);
    }

    public record Confirmacion(boolean ejecutada, String detalle) {
    }

    @Transactional
    public Confirmacion resolverConfirmacion(Auditoria.Actor actor, int localId, long ejecucionId, boolean aprobar) {
        modulos.exigir(localId, Modulo.M6);
        var e = repositorio.ejecucion(ejecucionId, localId).filter(x -> "PENDIENTE_CONFIRMACION".equals(x.resultado()))
                .orElseThrow(() -> new ErrorNegocio("M6_EJECUCION_NO_PENDIENTE", "La solicitud ya no está pendiente", 409));
        auditoria.fijarActor(actor);
        if (!aprobar) {
            repositorio.resolverEjecucion(e.id(), "RECHAZADA", actor.usuarioId(), null);
            return new Confirmacion(false, null);
        }
        Regla r = reglas.exigir(localId, e.reglaId());
        var res = ejecutar(localId, r.id(), reglas.interpretar(r).accion());
        repositorio.resolverEjecucion(e.id(), "EJECUTADA", actor.usuarioId(), json.writeValueAsString(Map.of("detalle", res.detalle())));
        if (res.estadoAccion() != null) {
            Instant ahora = reloj.instant();
            repositorio.guardarEstado(r.id(), Fase.ACTIVA.name(), null, null, ahora, json.writeValueAsString(conMarca(res.estadoAccion(), ahora.toEpochMilli())));
        }
        auditoria.registrar(actor, localId, "REGLA_CONFIRMAR", "ejecucion_regla", e.id(), "Aprobó la acción de \"" + r.nombre() + "\": " + res.detalle(), null);
        return new Confirmacion(true, res.detalle());
    }

    @Transactional
    public void eliminar(Auditoria.Actor actor, int localId, int id) {
        modulos.exigir(localId, Modulo.M6);
        Regla r = reglas.exigir(localId, id);
        auditoria.fijarActor(actor);
        if (r.estado() != null && "ACTIVA".equals(r.estado().fase())) {
            try {
                revertir(localId, r.id(), reglas.interpretar(r).accion(), leer(r.estado().estadoAccionJson()));
            } catch (RuntimeException e) {
                log.warn("No se pudo revertir la regla {} al borrarla: {}", id, e.getMessage());
            }
        }
        repositorio.eliminar(id);
        auditoria.registrar(actor, localId, "REGLA_ELIMINAR", "regla_balanceo", id, "Eliminó la regla \"" + r.nombre() + "\"", null);
    }

    public record Balanceo(boolean movido, Integer desde, Integer hacia, Integer diferencia, String ventanilla) {
    }

    /** Botón "Balancear ahora": mueve una ventanilla libre de la cola más vacía a la más llena (auditado). */
    @Transactional
    public Balanceo balancearAhora(Auditoria.Actor actor, int localId) {
        modulos.exigir(localId, Modulo.M6);
        var cargas = metricas.calcular(localId).detalle().stream()
                .map(c -> new ReglasBalanceo.CargaCola(c.colaId(), c.en_espera(), c.ventanillas_activas())).toList();
        var mov = ReglasBalanceo.sugerirMovimiento(cargas, 5);
        if (mov == null) {
            return new Balanceo(false, null, null, null, null);
        }
        var v = repositorio.ventanillaLibre(localId, mov.desde(), null, false).orElse(null);
        if (v == null) {
            return new Balanceo(false, null, null, null, null);
        }
        auditoria.fijarActor(actor);
        repositorio.moverVentanilla(v.id(), mov.hacia(), v.colaOriginalId(), v.reglaAsignadoraId());
        Map<String, Object> datos = new LinkedHashMap<>();
        datos.put("desde", mov.desde());
        datos.put("hacia", mov.hacia());
        datos.put("diferencia", mov.diferencia());
        auditoria.registrar(actor, localId, "BALANCEO", "ventanilla", v.id(), "Movió " + v.nombre() + " a otra cola", datos);
        eventos.publishEvent(new ColaActualizada(localId, null));
        return new Balanceo(true, mov.desde(), mov.hacia(), mov.diferencia(), v.nombre());
    }

    // --- Utilidades ---

    private static Map<String, Object> conMarca(Map<String, Object> estado, long ms) {
        Map<String, Object> m = new HashMap<>(estado);
        m.put("ejecutadaMs", ms);
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> leer(String texto) {
        if (texto == null || texto.isBlank() || "null".equals(texto)) {
            return null;
        }
        Object o = json.readValue(texto, Object.class);
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
    }

    private static Fase fase(String f) {
        try {
            return Fase.valueOf(f);
        } catch (RuntimeException e) {
            return Fase.INACTIVA;
        }
    }

    private static Long ms(Instant i) {
        return i == null ? null : i.toEpochMilli();
    }

    private static Instant instante(Long ms) {
        return ms == null ? null : Instant.ofEpochMilli(ms);
    }
}
