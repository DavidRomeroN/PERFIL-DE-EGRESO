package pe.turnoya.plataforma;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.tiempo.Fechas;

/**
 * N05: ¿está abierto el local ahora? Sin horarios definidos está siempre abierto (comportamiento original).
 * Si está cerrado, calcula la próxima apertura para mostrar "Abrimos el lunes a las 08:00".
 */
@Service
public class HorarioAtencion {

    private static final String[] DIAS = {"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"};

    private final JdbcClient jdbc;
    private final Clock reloj;

    HorarioAtencion(JdbcClient jdbc, Clock reloj) {
        this.jdbc = jdbc;
        this.reloj = reloj;
    }

    public EstadoHorario estado(Local local) {
        return calcular(horarios(local.id()), local, reloj.instant());
    }

    /** Regla pura: separada del acceso a datos para probarla con cualquier hora. */
    static EstadoHorario calcular(List<Horario> horarios, Local local, Instant ahora) {
        if (horarios.isEmpty()) {
            return EstadoHorario.ABIERTO;
        }
        Fechas.PartesLocales p = Fechas.partes(local.zonaHoraria(), ahora);
        int minutos = p.minutosDelDia();
        Optional<Horario> hoy = horarios.stream().filter(h -> h.diaSemana() == p.diaSemana()).findFirst();
        if (hoy.isPresent() && minutos >= Fechas.minutosDe(hoy.get().apertura()) && minutos < Fechas.minutosDe(hoy.get().cierre())) {
            return EstadoHorario.ABIERTO;
        }
        LocalDate fechaHoy = Fechas.fechaLocal(local.zonaHoraria(), ahora);
        for (int d = 0; d < 8; d++) {
            int dia = (p.diaSemana() + d) % 7;
            Optional<Horario> h = horarios.stream().filter(x -> x.diaSemana() == dia).findFirst();
            if (h.isEmpty() || (d == 0 && minutos >= Fechas.minutosDe(h.get().apertura()))) {
                continue;
            }
            int apertura = Fechas.minutosDe(h.get().apertura());
            Instant proxima = Fechas.instanteLocal(fechaHoy.plusDays(d), apertura / 60, apertura % 60, local.zonaHoraria());
            String cuando = d == 0 ? "hoy" : d == 1 ? "mañana" : "el " + DIAS[dia];
            return new EstadoHorario(false, "Estamos cerrados. Abrimos " + cuando + " a las " + h.get().apertura() + ".", proxima);
        }
        return new EstadoHorario(false, "Hoy no atendemos.", null);
    }

    private List<Horario> horarios(int localId) {
        return jdbc.sql("SELECT dia_semana, apertura, cierre FROM horario_local WHERE local_id = :local AND activo")
                .param("local", localId)
                .query((rs, i) -> new Horario(rs.getInt("dia_semana"), rs.getString("apertura"), rs.getString("cierre")))
                .list();
    }

    record Horario(int diaSemana, String apertura, String cierre) {
    }

    public record EstadoHorario(boolean abierto, String mensaje, Instant proximaApertura) {
        static final EstadoHorario ABIERTO = new EstadoHorario(true, null, null);
    }
}
