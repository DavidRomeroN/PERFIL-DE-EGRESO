package pe.turnoya.nucleo.aplicacion;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Promedios;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc.FilaHistorial;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;

/** N02: historial del día para el operador, paginado, con indicadores. */
@Service
public class HistorialTurnos {

    private final TurnosJdbc turnos;
    private final CatalogoLocales locales;
    private final Clock reloj;

    HistorialTurnos(TurnosJdbc turnos, CatalogoLocales locales, Clock reloj) {
        this.turnos = turnos;
        this.locales = locales;
        this.reloj = reloj;
    }

    @Transactional(readOnly = true)
    public Pagina consultar(int localId, LocalDate fecha, Integer ventanillaId, EstadoTurno estado, Integer cursor) {
        Local local = locales.exigir(localId);
        LocalDate dia = fecha != null ? fecha : Fechas.fechaLocal(local.zonaHoraria(), reloj.instant());
        List<FilaHistorial> items = turnos.historial(localId, dia, ventanillaId, estado, cursor);
        List<Turno> delDia = turnos.delDiaFiltrado(localId, dia, ventanillaId, estado);
        List<Turno> atendidos = delDia.stream()
                .filter(t -> t.estado() == EstadoTurno.ATENDIDO && t.llamadoAt() != null && t.finalizadoAt() != null).toList();
        Kpis kpis = new Kpis(
                delDia.size(),
                atendidos.size(),
                (int) delDia.stream().filter(t -> t.estado() == EstadoTurno.NO_SE_PRESENTO).count(),
                Promedios.minutos(atendidos.stream().map(t -> Promedios.entre(t.llamadoAt(), t.finalizadoAt())).toList()),
                Promedios.minutos(delDia.stream().filter(t -> t.llamadoAt() != null).map(t -> Promedios.entre(t.emitidoAt(), t.llamadoAt())).toList()));
        Integer siguiente = items.size() == 50 ? items.get(items.size() - 1).id() : null;
        return new Pagina(items, siguiente, kpis);
    }

    public record Pagina(List<FilaHistorial> items, Integer cursor, Kpis kpis) {
    }

    public record Kpis(int total, int atendidos, int noPresentados, double atencionPromMin, double esperaPromMin) {
    }
}
