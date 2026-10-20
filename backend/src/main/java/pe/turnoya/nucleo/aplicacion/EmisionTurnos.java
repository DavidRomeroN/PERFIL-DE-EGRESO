package pe.turnoya.nucleo.aplicacion;

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
import pe.turnoya.nucleo.OrigenCategoria;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.eventos.ColaActualizada;
import pe.turnoya.nucleo.eventos.TurnoEmitido;
import pe.turnoya.nucleo.infraestructura.ColasJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
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

    private final ColasJdbc colas;
    private final TurnosJdbc turnos;
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

    EmisionTurnos(ColasJdbc colas, TurnosJdbc turnos, CatalogoLocales locales, HorarioAtencion horario, ClientesTurno clientes,
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
     * RF07: ticket impreso desde la ventanilla para quien no tiene celular. {@code localDelOperador} nulo = super
     * admin (puede emitir en cualquier local).
     */
    @Transactional
    public TurnoPublico emitirTicket(Integer localDelOperador, int colaId, String nombre, String categoria) {
        Cola cola = colas.porId(colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        if (localDelOperador != null && cola.localId() != localDelOperador) {
            throw ErrorNegocio.prohibido("PROHIBIDO", "La cola pertenece a otro local");
        }
        return emitir(SolicitudEmision.ticket(colaId, nombre, categoria));
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
