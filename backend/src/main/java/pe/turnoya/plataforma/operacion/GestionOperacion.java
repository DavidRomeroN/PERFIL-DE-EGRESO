package pe.turnoya.plataforma.operacion;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.HorarioAtencion;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.dominio.RepositorioHorarios;
import pe.turnoya.plataforma.dominio.RepositorioHorarios.HorarioDia;
import pe.turnoya.plataforma.dominio.RepositorioLocales;

/** Horario del local (N05) y expiración automática de llamados (N04/RN04, opcional). */
@Service
public class GestionOperacion {

    static final String[] DIAS = {"Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"};
    private static final String HHMM = "^([01]\\d|2[0-3]):[0-5]\\d$";

    private final RepositorioHorarios horarios;
    private final RepositorioLocales locales;
    private final CatalogoLocales catalogo;
    private final HorarioAtencion horarioAtencion;
    private final Auditoria auditoria;

    GestionOperacion(RepositorioHorarios horarios, RepositorioLocales locales, CatalogoLocales catalogo, HorarioAtencion horarioAtencion,
                     Auditoria auditoria) {
        this.horarios = horarios;
        this.locales = locales;
        this.catalogo = catalogo;
        this.horarioAtencion = horarioAtencion;
        this.auditoria = auditoria;
    }

    /** Los 7 días (los no configurados salen inactivos de 08:00 a 18:00), el tiempo de ausencia y si ahora está abierto. */
    public Operacion consultar(int localId) {
        Local local = catalogo.exigir(localId);
        List<HorarioDia> guardados = horarios.todosDe(localId);
        List<Dia> dias = new ArrayList<>();
        for (int d = 0; d < 7; d++) {
            int dia = d;
            HorarioDia h = guardados.stream().filter(x -> x.diaSemana() == dia).findFirst().orElse(new HorarioDia(dia, "08:00", "18:00", false));
            dias.add(new Dia(dia, DIAS[dia], h.apertura(), h.cierre(), h.activo()));
        }
        return new Operacion(dias, local.tiempoAusenciaSeg(), horarioAtencion.estado(local));
    }

    /** Guarda los días que cambian: los activos y los que ya existían (para poder desactivarlos). */
    @Transactional
    public void guardarHorario(int localId, List<HorarioDia> dias, Auditoria.Actor actor) {
        List<HorarioDia> existentes = horarios.todosDe(localId);
        auditoria.fijarActor(actor);
        for (HorarioDia d : dias) {
            if (d.diaSemana() < 0 || d.diaSemana() > 6) {
                throw new ErrorNegocio("VALIDACION", "Día de la semana inválido", 422);
            }
            boolean existe = existentes.stream().anyMatch(x -> x.diaSemana() == d.diaSemana());
            if (!d.activo() && !existe) {
                continue;
            }
            if (d.apertura() == null || d.cierre() == null || !d.apertura().matches(HHMM) || !d.cierre().matches(HHMM)) {
                throw new ErrorNegocio("VALIDACION", DIAS[d.diaSemana()] + ": formato HH:MM", 422);
            }
            if (d.activo() && d.apertura().compareTo(d.cierre()) >= 0) {
                throw new ErrorNegocio("VALIDACION", DIAS[d.diaSemana()] + ": la apertura debe ser antes del cierre", 422);
            }
            horarios.guardar(localId, d);
            auditoria.registrar(actor, localId, "HORARIO", "horario_local", d.diaSemana(),
                    "Horario del " + DIAS[d.diaSemana()].toLowerCase() + ": " + (d.activo() ? d.apertura() + "–" + d.cierre() : "cerrado"), null);
        }
    }

    @Transactional
    public void guardarAusencia(int localId, Integer segundos, Auditoria.Actor actor) {
        if (segundos != null && (segundos < 30 || segundos > 900)) {
            throw new ErrorNegocio("VALIDACION", "El tiempo de ausencia va de 30 a 900 segundos", 422);
        }
        auditoria.fijarActor(actor);
        locales.actualizarAusencia(localId, segundos);
        auditoria.registrar(actor, localId, "AUSENCIA", "local", localId,
                segundos == null ? "Desactivó la expiración automática" : "Expiración automática a los " + segundos + " s",
                segundos == null ? null : Map.of("ausenciaSeg", segundos));
    }

    public record Dia(int diaSemana, String nombre, String apertura, String cierre, boolean activo) {
    }

    public record Operacion(List<Dia> horarios, Integer tiempoAusenciaSeg, HorarioAtencion.EstadoHorario estado) {
    }
}
