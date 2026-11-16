package pe.turnoya.nucleo.seguimiento;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.RepositorioTurnos;
import pe.turnoya.nucleo.dominio.RepositorioValoraciones;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.dominio.Valoracion;

/** N07: el cliente valora la atención (1 a 5 estrellas), una sola vez por turno atendido. */
@Service
public class Valoraciones {

    private final RepositorioTurnos turnos;
    private final RepositorioValoraciones valoraciones;

    Valoraciones(RepositorioTurnos turnos, RepositorioValoraciones valoraciones) {
        this.turnos = turnos;
        this.valoraciones = valoraciones;
    }

    @Transactional
    public Valoracion valorar(String token, int estrellas, String comentario) {
        Turno t = turnos.porToken(token).filter(x -> x.estado() == EstadoTurno.ATENDIDO)
                .orElseThrow(() -> ErrorNegocio.conflicto("VALIDACION", "Solo se valora un turno ya atendido"));
        if (valoraciones.existe(t.id())) {
            throw ErrorNegocio.conflicto("M7_VALORACION_DUPLICADA", "Este turno ya fue valorado");
        }
        return valoraciones.guardar(t.id(), estrellas, Valoracion.limpiarComentario(comentario));
    }

    @Transactional(readOnly = true)
    public boolean existe(int turnoId) {
        return valoraciones.existe(turnoId);
    }
}
