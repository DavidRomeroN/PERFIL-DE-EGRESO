package pe.turnoya.transferencias;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.datos.DespuesDelCommit;
import pe.turnoya.notificaciones.AvisosAlCliente;
import pe.turnoya.nucleo.ConsultaTurnos;
import pe.turnoya.nucleo.ContactoTurnos;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.transferencias.dominio.RepositorioTransferencias;

/**
 * §6.1 Transferencia de un turno a otra cola en una transacción: el sucesor conserva la hora de emisión y la
 * categoría (conserva su lugar), queda la fila en {@code transferencia} y el cliente recibe un aviso con su nuevo código.
 * La usan el panel del operador, el panel de kiosco y la API.
 */
@Service
public class Transferencias {

    private static final Logger log = LoggerFactory.getLogger(Transferencias.class);

    /** Motivos que se pueden elegir. "BALANCEO" queda solo en {@link #NOMBRES_MOTIVO} para el historial antiguo. */
    public static final List<String> MOTIVOS = List.of("OTRO_SERVICIO", "FALTA_DOCUMENTO", "DERIVACION", "ERROR_DE_COLA");
    public static final Map<String, String> NOMBRES_MOTIVO = Map.of("OTRO_SERVICIO", "Necesita otro servicio", "FALTA_DOCUMENTO", "Le falta un documento",
            "DERIVACION", "Derivación", "ERROR_DE_COLA", "Se equivocó de cola", "BALANCEO", "Balanceo de carga");

    private final TomaDeTurnos toma;
    private final ConsultaTurnos consulta;
    private final ContactoTurnos contactos;
    private final AvisosAlCliente avisos;
    private final RepositorioTransferencias repositorio;
    private final ModulosLocal modulos;
    private final Auditoria auditoria;
    private final PropiedadesTurnoYa propiedades;
    private final MeterRegistry metricas;

    Transferencias(TomaDeTurnos toma, ConsultaTurnos consulta, ContactoTurnos contactos, AvisosAlCliente avisos, RepositorioTransferencias repositorio,
                   ModulosLocal modulos, Auditoria auditoria, PropiedadesTurnoYa propiedades, MeterRegistry metricas) {
        this.toma = toma;
        this.consulta = consulta;
        this.contactos = contactos;
        this.avisos = avisos;
        this.repositorio = repositorio;
        this.modulos = modulos;
        this.auditoria = auditoria;
        this.propiedades = propiedades;
        this.metricas = metricas;
    }

    public record Solicitud(int aColaId, Integer aVentanillaId, String motivo, String detalle, boolean notificar) {

        public static Solicitud manual(int aColaId, Integer aVentanillaId, String motivo, String detalle, Boolean notificar) {
            return new Solicitud(aColaId, aVentanillaId, motivo, detalle, notificar == null || notificar);
        }
    }

    @Transactional
    public TurnoPublico transferir(Auditoria.Actor actor, int localId, int turnoId, Solicitud s) {
        long t0 = System.nanoTime();
        modulos.exigir(localId, Modulo.M6);
        if (s.motivo() == null || !MOTIVOS.contains(s.motivo())) {
            throw new ErrorNegocio("VALIDACION", "Elige un motivo válido", 422);
        }
        String detalle = s.detalle() == null || s.detalle().isBlank() ? null : s.detalle().trim();
        if (detalle != null && detalle.length() > 200) {
            throw new ErrorNegocio("VALIDACION", "El detalle tiene hasta 200 caracteres", 422);
        }
        if (s.aVentanillaId() != null && !repositorio.ventanillaActiva(s.aVentanillaId(), localId)) {
            throw new ErrorNegocio("M6_COLA_DESTINO_INVALIDA", "La ventanilla destino no existe", 404);
        }
        auditoria.fijarActor(actor);
        var r = toma.transferir(localId, turnoId, s.aColaId());
        repositorio.registrarTransferencia(new RepositorioTransferencias.NuevaTransferencia(localId, r.origenId(), r.sucesorId(), r.deColaId(), r.aColaId(),
                s.aVentanillaId(), s.motivo(), detalle, actor.usuarioId()));
        auditoria.registrar(actor, localId, "TRANSFERIR_TURNO", "turno", r.origenId(),
                "Transfirió " + r.origenCodigo() + " a " + r.colaDestino() + " (" + r.sucesorCodigo() + ")",
                Map.of("sucesorId", r.sucesorId(), "motivo", s.motivo()));
        metricas.timer("m6_transferencia_ms").record(java.time.Duration.ofNanos(System.nanoTime() - t0));
        metricas.counter("m6_transferencias_total", "motivo", s.motivo()).increment();
        if (s.notificar()) {
            DespuesDelCommit.ejecutar(() -> notificar(localId, r));
        }
        return consulta.porToken(r.sucesorToken());
    }

    private void notificar(int localId, TomaDeTurnos.TurnoTransferido r) {
        try {
            var c = contactos.de(r.sucesorId()).orElse(null);
            String texto = "🔁 Te derivamos a *" + r.colaDestino() + "*. Tu nuevo turno es *" + r.sucesorCodigo()
                    + "* y conservas tu lugar. Sigue aquí: " + propiedades.urlPublica() + "/t/" + r.sucesorToken();
            avisos.deTurno(localId, r.sucesorId(), c == null ? null : c.telefonoE164(), "turno_transferido",
                    List.of(r.colaDestino(), r.sucesorCodigo()), texto);
        } catch (RuntimeException e) {
            log.warn("No se pudo avisar la transferencia del turno {}: {}", r.sucesorId(), e.getMessage());
        }
    }

    public record Bloque(List<RepositorioTransferencias.Transferible> turnos, Map<Integer, String> colas) {
    }

    /** Si el local tiene contratadas las transferencias (M6). */
    public boolean disponible(int localId) {
        return modulos.activo(localId, Modulo.M6);
    }

    /** Colas activas del local (id → nombre), para elegir el destino. */
    public Map<Integer, String> colas(int localId) {
        return repositorio.colas(localId);
    }

    /** Datos del bloque "Transferir" del panel. */
    public Bloque bloquePanel(int localId, java.time.LocalDate fecha, Integer ventanillaId) {
        return new Bloque(repositorio.transferibles(localId, fecha, ventanillaId, 40), repositorio.colas(localId));
    }

    public record Historial(List<RepositorioTransferencias.Transferencia> items, Integer cursor) {
    }

    public Historial historial(int localId, Instant desde, Instant hasta, Integer cursor) {
        modulos.exigir(localId, Modulo.M6);
        var filas = repositorio.transferencias(localId, desde, hasta, cursor, 50);
        return new Historial(filas, filas.size() == 50 ? filas.getLast().id() : null);
    }
}
