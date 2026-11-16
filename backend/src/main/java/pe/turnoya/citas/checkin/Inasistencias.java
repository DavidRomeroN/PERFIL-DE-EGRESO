package pe.turnoya.citas.checkin;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Service;
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.dominio.ReglasCitas;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.reserva.ReservaCitas;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.eventos.TurnoCerrado;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/**
 * Inasistencias y recordatorios: RN-M3-04 no-show pasada la ventana y la gracia, RN-M3-06 bloqueo de reincidentes,
 * RN-M3-07 la cita sigue al turno que generó, RN-M3-08 recordatorios T−24 h y T−2 h (una vez cada uno).
 */
@Service
public class Inasistencias {

    private final RepositorioCitas repositorio;
    private final ReservaCitas reservas;
    private final ModulosLocal modulos;
    private final Clock reloj;

    Inasistencias(RepositorioCitas repositorio, ReservaCitas reservas, ModulosLocal modulos, Clock reloj) {
        this.repositorio = repositorio;
        this.reservas = reservas;
        this.modulos = modulos;
        this.reloj = reloj;
    }

    /** @return {@code true} si quedó bloqueado ahora. */
    public boolean aplicarBloqueo(int localId, int clienteId, int colaId) {
        var cfg = repositorio.config(colaId);
        Instant ahora = reloj.instant();
        int n = repositorio.noShowsDesde(localId, clienteId, ahora.minus(Duration.ofDays(90)));
        if (!ReglasCitas.debeBloquear(n, cfg.maxNoShow()) || repositorio.hayBloqueoVigente(localId, clienteId, ahora)) {
            return false;
        }
        repositorio.crearBloqueoCliente(localId, clienteId, ahora.plus(Duration.ofDays(cfg.bloqueoDias())), n + " inasistencias en 90 días");
        return true;
    }

    /** RN-M3-07: al cerrar el turno de la cita se actualiza la cita. */
    @ApplicationModuleListener
    void alCerrarTurno(TurnoCerrado e) {
        if (e.citaId() == null) {
            return;
        }
        EstadoCita hacia = e.estado() == EstadoTurno.ATENDIDO ? EstadoCita.ATENDIDA : e.estado() == EstadoTurno.NO_SE_PRESENTO ? EstadoCita.NO_SHOW : null;
        if (hacia == null) {
            return;
        }
        repositorio.cita(e.citaId()).filter(c -> c.estado() == EstadoCita.CHECKIN).ifPresent(c -> {
            repositorio.marcarEstado(c.id(), hacia);
            reservas.evento(c.id(), hacia.name(), Map.of("porTurno", true), "sistema");
            if (hacia == EstadoCita.NO_SHOW) {
                aplicarBloqueo(c.localId(), c.clienteId(), c.colaId());
            }
        });
    }

    public Map<String, Object> jobNoShow() {
        var vencidas = repositorio.marcarNoShowVencidas(reloj.instant());
        int bloqueados = 0;
        for (var v : vencidas) {
            reservas.evento(v.id(), "NO_SHOW", null, "sistema");
            reservas.anunciar(v.localId(), v.id(), v.token(), "NO_SHOW");
            if (aplicarBloqueo(v.localId(), v.clienteId(), v.colaId())) {
                bloqueados++;
            }
        }
        return Map.of("noShow", vencidas.size(), "bloqueados", bloqueados);
    }

    public Map<String, Object> jobRecordatorios() {
        Instant ahora = reloj.instant();
        int enviados = 0;
        for (var c : repositorio.paraRecordar(ahora, ahora.plus(Duration.ofHours(25)))) {
            if (!modulos.activo(c.localId(), Modulo.M3)) {
                continue;
            }
            for (int minutos : c.recordatoriosMin()) {
                Instant momento = c.inicio().minus(Duration.ofMinutes(minutos));
                if (ahora.isBefore(momento) || ahora.isAfter(momento.plus(Duration.ofMinutes(60)))) {
                    continue;
                }
                String tipo = minutos >= 1440 ? "24h" : "2h";
                if (!repositorio.registrarRecordatorio(c.id(), tipo)) {
                    continue;
                }
                reservas.notificar(c.id(), tipo);
                enviados++;
            }
        }
        return Map.of("enviados", enviados);
    }

    /** Jobs de M3 (mismos nombres que el sistema anterior). */
    @Configuration(proxyBeanMethods = false)
    static class Tareas {

        @Bean
        TareaProgramada citasRecordatorios(Inasistencias i) {
            return TareaProgramada.cada("citas-recordatorios", Duration.ofMinutes(5), "M3: recordatorios T−24 h y T−2 h (una vez por cita)", i::jobRecordatorios);
        }

        @Bean
        TareaProgramada citasNoShow(Inasistencias i) {
            return TareaProgramada.cada("citas-no-show", Duration.ofMinutes(5), "M3: marca inasistencias y bloquea reincidentes", i::jobNoShow);
        }

        @Bean
        TareaProgramada citasGenerarSlots(DisponibilidadCitas d) {
            return TareaProgramada.diaria("citas-generar-slots", LocalTime.of(1, 0), "M3: prepara los horarios de los próximos días", d::jobGenerarSlots);
        }
    }
}
