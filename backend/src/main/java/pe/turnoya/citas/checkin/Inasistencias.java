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
 * Inasistencias y recordatorios: RN-M3-04 no-show pasada la ventana y la gracia, sanción escalonada por cada falta
 * (1 día, luego 3, 7, 15 y 30 sin poder reservar en ese local; ver {@link ReglasCitas#diasDeSancion}),
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

    /**
     * Cada falta sanciona: cuantas más faltas seguidas, más días sin poder reservar en el local.
     *
     * @return {@code true} si quedó sancionado (o se alargó su sanción) ahora.
     */
    public boolean aplicarBloqueo(int localId, int clienteId, int colaId) {
        Instant ahora = reloj.instant();
        int faltas = repositorio.faltasSeguidas(localId, clienteId, ahora.minus(Duration.ofDays(ReglasCitas.MEMORIA_FALTAS_DIAS)));
        int dias = ReglasCitas.diasDeSancion(faltas);
        if (dias == 0) {
            return false;
        }
        Instant hasta = ahora.plus(Duration.ofDays(dias));
        var vigente = repositorio.bloqueoVigente(localId, clienteId, ahora);
        if (vigente.isPresent() && !vigente.get().isBefore(hasta)) {
            return false;
        }
        String motivo = "No se presentó a su cita" + (faltas > 1 ? " (" + faltas + " faltas seguidas)" : "") + ": sin citas por "
                + ReglasCitas.textoDias(dias);
        repositorio.crearBloqueoCliente(localId, clienteId, hasta, motivo);
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
            return TareaProgramada.cada("citas-no-show", Duration.ofMinutes(5), "M3: marca inasistencias y aplica la sanción escalonada", i::jobNoShow);
        }

        @Bean
        TareaProgramada citasGenerarSlots(DisponibilidadCitas d) {
            return TareaProgramada.diaria("citas-generar-slots", LocalTime.of(1, 0), "M3: prepara los horarios de los próximos días", d::jobGenerarSlots);
        }
    }
}
