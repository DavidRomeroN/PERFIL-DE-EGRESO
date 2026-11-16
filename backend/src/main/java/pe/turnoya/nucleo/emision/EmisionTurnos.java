package pe.turnoya.nucleo.emision;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.datos.DespuesDelCommit;
import pe.turnoya.compartido.seguridad.Tokens;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.eventos.TurnoCambioEstado;
import pe.turnoya.nucleo.OrigenCategoria;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.avisos.AvisosCola;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoEmitido;
import pe.turnoya.nucleo.extensiones.ExtensionesNucleo;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.dominio.RepositorioTurnos;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad.CategoriaAsignada;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.HorarioAtencion;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;
import tools.jackson.databind.ObjectMapper;

/**
 * Emisión de turnos (RF01, RF07): RN01 numeración diaria, RN03 un turno activo por cliente y cola, RN05 límite del
 * plan, N05 horario, M1 categoría. La numeración y el orden los calcula {@code emitir_turno} en la BD.
 */
@Service
public class EmisionTurnos {

    private final RepositorioColas colas;
    private final RepositorioTurnos turnos;
    private final CatalogoLocales locales;
    private final HorarioAtencion horario;
    private final ClientesTurno clientes;
    private final ExtensionesNucleo extensiones;
    private final AvisosCola avisos;
    private final ConsultaTurnos consulta;
    private final ApplicationEventPublisher eventos;
    private final MeterRegistry metricas;
    private final ObjectMapper json;
    private final Clock reloj;

    EmisionTurnos(RepositorioColas colas, RepositorioTurnos turnos, CatalogoLocales locales, HorarioAtencion horario, ClientesTurno clientes,
                  ExtensionesNucleo extensiones, AvisosCola avisos, ConsultaTurnos consulta, ApplicationEventPublisher eventos,
                  MeterRegistry metricas, ObjectMapper json, Clock reloj) {
        this.colas = colas;
        this.turnos = turnos;
        this.locales = locales;
        this.horario = horario;
        this.clientes = clientes;
        this.extensiones = extensiones;
        this.avisos = avisos;
        this.consulta = consulta;
        this.eventos = eventos;
        this.metricas = metricas;
        this.json = json;
        this.reloj = reloj;
    }

    @Transactional
    public TurnoPublico emitir(SolicitudEmision s) {
        Cola cola = colas.porId(s.colaId()).filter(Cola::activa)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe o está inactiva"));
        Local local = locales.exigir(cola.localId());
        if (!local.activo()) {
            throw ErrorNegocio.prohibido("LOCAL_INACTIVO", "El local está inactivo");
        }
        validarHorario(s, local);

        Optional<CategoriaAsignada> categoria = extensiones.categoria(local.id(), s.categoriaCodigo(), s.origen());
        Instant emitidoAt = s.emitidoAt() != null ? s.emitidoAt() : reloj.instant();
        LocalDate fecha = Fechas.fechaLocal(local.zonaHoraria(), emitidoAt);
        if (!s.omitirLimitePlan()) {
            validarLimitePlan(local, fecha);
        }

        Integer clienteId = s.clienteId() != null ? s.clienteId() : clientes.resolver(s.telefono(), s.nombre(), s.consentimiento());
        if (clienteId != null) {
            turnos.activoDeCliente(cola.id(), clienteId).ifPresent(activo -> {
                throw duplicado(activo.codigo(), activo.token());
            });
        }

        String token = Tokens.generar(10);
        int turnoId;
        try {
            turnoId = turnos.emitir(cola.id(), clienteId, s.canal(), token, fecha, categoria.map(CategoriaAsignada::id).orElse(null),
                    s.emitidoAt(), origen(s));
        } catch (DuplicateKeyException e) {
            // Dos emisiones simultáneas del mismo celular: el índice ux_turno_activo_cliente deja pasar solo una
            throw new ErrorNegocio("TURNO_DUPLICADO", "Ya tienes un turno activo en esta cola", 409);
        }
        if (categoria.isPresent() && s.origen() == OrigenCategoria.PERSONAL) {
            turnos.marcarPrioridadVerificada(turnoId);
        }

        metricas.counter("turnos_emitidos_total", "canal", s.canal().name()).increment();
        eventos.publishEvent(new TurnoEmitido(local.id(), turnoId, cola.id(), s.canal().name()));
        eventos.publishEvent(new ColaActualizada(local.id(), cola.id()));
        // Si la cola está casi vacía, al recién llegado puede tocarle el aviso de inmediato
        DespuesDelCommit.ejecutar(() -> avisos.revisar(cola.id()));
        return consulta.porToken(token);
    }

    /**
     * M6 · Transferencia (RN-M6-02): el sucesor hereda la hora de emisión y la categoría (conserva su lugar) y el
     * original queda TRANSFERIDO apuntando a él (su enlace de seguimiento redirige). Dentro de la transacción de quien llama.
     */
    @Transactional
    public Transferido transferir(int localId, int turnoId, int aColaId) {
        var t = turnos.bloquearEnLocal(turnoId, localId)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        if (!t.estado().puedePasarA(EstadoTurno.TRANSFERIDO)) {
            throw new ErrorNegocio("M6_ESTADO_NO_TRANSFERIBLE", "Un turno " + t.estado().name() + " no se puede transferir", 409);
        }
        Cola destino = colas.porIdEnLocal(aColaId, localId).filter(Cola::activa)
                .filter(c -> c.id() != t.colaId())
                .orElseThrow(() -> new ErrorNegocio("M6_COLA_DESTINO_INVALIDA", "Elige otra cola activa del local", 404));
        if (t.clienteId() != null && turnos.activoDeCliente(destino.id(), t.clienteId()).isPresent()) {
            throw new ErrorNegocio("M6_CLIENTE_YA_EN_DESTINO", "El cliente ya tiene un turno en esa cola", 409);
        }
        Local local = locales.exigir(localId);
        Instant ahora = reloj.instant();
        String token = Tokens.generar(10);
        Map<String, Object> origen = new LinkedHashMap<>();
        origen.put("transferido_de", t.id());
        int sucesorId = turnos.emitir(destino.id(), t.clienteId(), t.canal(), token, Fechas.fechaLocal(local.zonaHoraria(), ahora),
                t.categoriaId(), t.emitidoAt(), json.writeValueAsString(origen));
        turnos.marcarTransferido(t.id(), sucesorId, ahora, t.estado() == EstadoTurno.LLAMADO);
        if (Boolean.TRUE.equals(t.prioridadVerificada())) {
            turnos.marcarPrioridadVerificada(sucesorId);
        }
        var sucesor = turnos.porId(sucesorId).orElseThrow();
        eventos.publishEvent(new TurnoCambioEstado(localId, t.id(), t.token(), EstadoTurno.TRANSFERIDO));
        eventos.publishEvent(new ColaActualizada(localId, t.colaId()));
        eventos.publishEvent(new ColaActualizada(localId, destino.id()));
        DespuesDelCommit.ejecutar(() -> avisos.revisar(destino.id()));
        return new Transferido(t.id(), t.codigo(), t.colaId(), sucesor.id(), sucesor.codigo(), sucesor.token(), destino.id(), destino.nombre());
    }

    public record Transferido(int origenId, String origenCodigo, int deColaId, int sucesorId, String sucesorCodigo, String sucesorToken,
                              int aColaId, String colaDestino) {
    }

    /** Cliente para un canal que no emite al instante (citas): mismo criterio que la emisión (celular solo con consentimiento). */
    @Transactional
    public Integer resolverCliente(String nombre, String telefono, boolean consentimiento) {
        return clientes.resolver(telefono, nombre, consentimiento);
    }

    /**
     * RF07: ticket impreso desde la ventanilla para quien no tiene celular. {@code localDelOperador} nulo = super
     * admin (puede emitir en cualquier local).
     */
    @Transactional
    public TurnoPublico emitirTicket(Integer localDelOperador, int colaId, String nombre, String categoria) {
        return emitirTicket(localDelOperador, colaId, nombre, categoria, null, false);
    }

    /** Con {@code telefono}: el cliente sin app recibe por WhatsApp la confirmación y el llamado. */
    @Transactional
    public TurnoPublico emitirTicket(Integer localDelOperador, int colaId, String nombre, String categoria, String telefono, boolean consentimiento) {
        Cola cola = colas.porId(colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        if (localDelOperador != null && cola.localId() != localDelOperador) {
            throw ErrorNegocio.prohibido("PROHIBIDO", "La cola pertenece a otro local");
        }
        String tel = telefono == null || telefono.isBlank() ? null : telefono.trim();
        return emitir(SolicitudEmision.ticket(colaId, nombre, categoria, tel, tel != null && consentimiento));
    }

    private void validarHorario(SolicitudEmision s, Local local) {
        if (s.omitirHorario()) {
            return;
        }
        HorarioAtencion.EstadoHorario estado = horario.estado(local);
        if (!estado.abierto()) {
            Map<String, Object> extra = new HashMap<>();
            extra.put("proximaApertura", estado.proximaApertura() == null ? null : estado.proximaApertura().toString());
            throw new ErrorNegocio("COLA_CERRADA", estado.mensaje() != null ? estado.mensaje() : "El local está cerrado", 409, extra);
        }
    }

    private void validarLimitePlan(Local local, LocalDate fecha) {
        Plan plan = locales.planDe(local);
        if (turnos.contarDesde(local.id(), fecha.withDayOfMonth(1)) >= plan.maxTurnosMes()) {
            throw new ErrorNegocio("LIMITE_PLAN", "El plan " + plan.nombre() + " permite hasta " + plan.maxTurnosMes() + " turnos al mes", 402);
        }
    }

    private static ErrorNegocio duplicado(String codigo, String token) {
        return new ErrorNegocio("TURNO_DUPLICADO", "Este celular ya tiene el turno " + codigo + " activo en esta cola", 409,
                Map.of("token", token, "codigo", codigo));
    }

    /** Contexto de emisión que guarda {@code emitir_turno} (trazabilidad entre módulos, F5). */
    private String origen(SolicitudEmision s) {
        Map<String, Object> origen = new LinkedHashMap<>();
        origen.put("cita_id", s.citaId());
        origen.put("dispositivo_id", s.dispositivoId());
        origen.put("codigo_provisional", s.codigoProvisional());
        origen.put("transferido_de", s.transferidoDe());
        return json.writeValueAsString(origen);
    }
}
