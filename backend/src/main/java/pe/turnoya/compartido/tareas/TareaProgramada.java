package pe.turnoya.compartido.tareas;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.function.Supplier;
import pe.turnoya.compartido.tiempo.Fechas;

/**
 * Tarea periódica de un módulo. Cada módulo declara las suyas como beans:
 *
 * <pre>{@code
 * @Bean TareaProgramada expirarLlamados(ExpiracionLlamados uc) {
 *     return TareaProgramada.cada("expirar-llamados", Duration.ofSeconds(15), "RN04: …", uc::ejecutar);
 * }
 * }</pre>
 *
 * El {@link PlanificadorTareas} las reclama en {@code job_estado}: aunque haya varias réplicas (o legacy/
 * conviviendo con el mismo nombre de tarea), cada corrida la ejecuta una sola instancia.
 */
public record TareaProgramada(String nombre, String descripcion, Duration cada, LocalTime diaria, ZoneId zona, Supplier<?> accion) {

    public static TareaProgramada cada(String nombre, Duration cada, String descripcion, Supplier<?> accion) {
        return new TareaProgramada(nombre, descripcion, cada, null, Fechas.LIMA, accion);
    }

    public static TareaProgramada diaria(String nombre, LocalTime hora, String descripcion, Supplier<?> accion) {
        return new TareaProgramada(nombre, descripcion, null, hora, Fechas.LIMA, accion);
    }

    public boolean esPeriodica() {
        return cada != null;
    }

    /** Próxima corrida después de {@code desde}. */
    public Instant proxima(Instant desde) {
        if (cada != null) {
            return desde.plus(cada);
        }
        LocalDate hoy = Fechas.fechaLocal(zona, desde);
        Instant candidato = Fechas.instanteLocal(hoy, diaria.getHour(), diaria.getMinute(), zona);
        return candidato.isAfter(desde) ? candidato : Fechas.instanteLocal(hoy.plusDays(1), diaria.getHour(), diaria.getMinute(), zona);
    }

    public String frecuencia() {
        return cada != null ? "cada " + cada.toSeconds() + " s" : "diaria " + diaria;
    }
}
