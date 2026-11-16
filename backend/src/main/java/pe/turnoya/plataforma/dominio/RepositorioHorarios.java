package pe.turnoya.plataforma.dominio;

import java.util.List;

/** Puerto de salida: horario de atención de cada local. Lo implementa {@code infraestructura.HorariosJdbc}. */
public interface RepositorioHorarios {

    List<Horario> activosDe(int localId);

    /** Los días configurados (activos o no), ordenados de domingo a sábado. */
    List<HorarioDia> todosDe(int localId);

    void guardar(int localId, HorarioDia horario);

    record HorarioDia(int diaSemana, String apertura, String cierre, boolean activo) {
    }
}
