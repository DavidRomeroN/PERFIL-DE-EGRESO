package pe.turnoya.nucleo.appmovil;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.dominio.RepositorioApp;
import pe.turnoya.nucleo.dominio.RepositorioApp.Falta;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.emision.EmisionTurnos;
import pe.turnoya.nucleo.emision.SolicitudEmision;

/**
 * Tomar turno desde la app móvil. Antes de emitir exige: (1) la marca de presencia del QR de la TV, (2) el
 * identificador del dispositivo, con un solo turno activo por dispositivo y cola, y (3) si viene una sesión, que sea
 * válida: entonces el turno queda a nombre del cliente verificado.
 *
 * <p>Antifraude: quien no se presentó a {@code max-faltas} turnos en los últimos {@code dias-faltas} días (por
 * teléfono o por cuenta) no puede tomar turno hasta que la falta más antigua salga de esa ventana, y nadie tiene
 * más de {@code max-activos} turnos activos a la vez entre todos los locales (por defecto uno por cuenta o teléfono).
 */
@Service
public class TurnosApp {

    private final RepositorioColas colas;
    private final RepositorioApp repositorio;
    private final PresenciaApp presencia;
    private final CuentasApp cuentas;
    private final EmisionTurnos emision;
    private final Clock reloj;
    private final boolean exigirPresencia;
    private final int maxFaltas;
    private final Duration ventanaFaltas;
    private final int maxActivos;

    TurnosApp(RepositorioColas colas, RepositorioApp repositorio, PresenciaApp presencia, CuentasApp cuentas, EmisionTurnos emision, Clock reloj,
              @Value("${turnoya.app.exigir-presencia:true}") boolean exigirPresencia,
              @Value("${turnoya.app.max-faltas:3}") int maxFaltas,
              @Value("${turnoya.app.dias-faltas:7}") int diasFaltas,
              @Value("${turnoya.app.max-activos:1}") int maxActivos) {
        this.maxFaltas = maxFaltas;
        this.ventanaFaltas = Duration.ofDays(diasFaltas);
        this.maxActivos = maxActivos;
        this.colas = colas;
        this.repositorio = repositorio;
        this.presencia = presencia;
        this.cuentas = cuentas;
        this.emision = emision;
        this.reloj = reloj;
        this.exigirPresencia = exigirPresencia;
    }

    public record Pedido(int colaId, String nombre, String categoriaCodigo, String presencia, String dispositivo, String autorizacion) {
    }

    @Transactional
    public TurnoPublico tomar(Pedido p) {
        Cola cola = colas.porId(p.colaId()).filter(Cola::activa)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe o está inactiva"));
        if (exigirPresencia && !presencia.valida(cola.localId(), p.presencia())) {
            throw new ErrorNegocio("APP_QR_VENCIDO", "Escanea de nuevo el QR de la pantalla del local para tomar tu turno.", 403);
        }
        String dispositivo = CuentasApp.hashDispositivo(p.dispositivo());
        Integer clienteId = cuentas.clienteDe(p.autorizacion()).orElse(null);

        // Dos toques seguidos del mismo teléfono no deben dar dos turnos
        repositorio.bloquearDispositivo(dispositivo);
        repositorio.activoDeDispositivo(cola.id(), dispositivo).ifPresent(activo -> {
            throw new ErrorNegocio("TURNO_DUPLICADO", "Ya tienes el turno " + activo.codigo() + " activo en esta cola", 409,
                    Map.of("token", activo.token(), "codigo", activo.codigo()));
        });
        exigirBuenaConducta(dispositivo, clienteId);

        // Con sesión el turno es del cliente verificado; sin ella es anónimo con el nombre que escribió
        SolicitudEmision solicitud = new SolicitudEmision(cola.id(), CanalTurno.APP, clienteId == null ? p.nombre() : null, null, false,
                p.categoriaCodigo(), null, clienteId, null, null, null, null, null, false, false);
        TurnoPublico turno = emision.emitir(solicitud);
        repositorio.idDeTurno(turno.token()).ifPresent(id -> repositorio.registrarTurno(id, dispositivo, reloj.instant()));
        return turno;
    }

    /**
     * Estado antifraude del teléfono o del cliente: faltas en la ventana, hasta cuándo está bloqueado (nulo si no) y
     * cuántos turnos activos tiene. Lo usan la emisión y el perfil de la app.
     */
    public record Conducta(List<Falta> faltas, int maxFaltas, int diasFaltas, Instant bloqueadoHasta, int activos, int maxActivos) {
    }

    @Transactional(readOnly = true)
    public Conducta conducta(String dispositivoHash, Integer clienteId) {
        Instant ahora = reloj.instant();
        List<Falta> faltas = repositorio.faltas(dispositivoHash, clienteId, ahora.minus(ventanaFaltas), 20);
        // Bloqueado mientras haya maxFaltas en la ventana: se libera cuando la maxFaltas-ésima más reciente sale de ella
        Instant hasta = faltas.size() >= maxFaltas ? faltas.get(maxFaltas - 1).fecha().plus(ventanaFaltas) : null;
        int activos = repositorio.activos(dispositivoHash, clienteId, ahora.minus(Duration.ofDays(1)));
        return new Conducta(faltas, maxFaltas, (int) ventanaFaltas.toDays(), hasta, activos, maxActivos);
    }

    /** Bloqueo por faltas y tope de turnos activos (ver la clase). */
    private void exigirBuenaConducta(String dispositivo, Integer clienteId) {
        Conducta c = conducta(dispositivo, clienteId);
        if (c.bloqueadoHasta() != null) {
            throw new ErrorNegocio("APP_BLOQUEADO_FALTAS", "No te presentaste a " + maxFaltas + " turnos en los últimos " + c.diasFaltas()
                    + " días. Podrás volver a tomar turno desde la app más adelante; mientras, acércate al local.", 403,
                    Map.of("hasta", c.bloqueadoHasta().toString(), "faltas", c.faltas().size()));
        }
        if (c.activos() >= maxActivos) {
            throw new ErrorNegocio("APP_MAX_TURNOS", (maxActivos == 1 ? "Ya tienes un turno activo. Espera a que te atiendan o cancélalo para tomar otro."
                    : "Ya tienes " + maxActivos + " turnos activos. Termina o cancela uno para tomar otro."), 409,
                    Map.of("maximo", maxActivos));
        }
    }
}
