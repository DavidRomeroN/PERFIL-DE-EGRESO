package pe.turnoya.citas.reserva;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.citas.checkin.CheckinCitas;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.citas.dominio.RepositorioCitas.Cita;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.ClientesApp;

/**
 * {@code /api/v1/public/app/citas}: citas desde la app móvil, siempre con la cuenta del cliente
 * ({@code Authorization: Bearer …}). Sus citas y sanciones, reservar, cancelar y el check-in al llegar al local, que
 * exige escanear el QR «App» de la TV (prueba de que está ahí).
 */
@RestController
@RequestMapping("/api/v1/public/app/citas")
class CitasAppApi {

    private final ClientesApp clientes;
    private final ReservaCitas reservas;
    private final CheckinCitas checkin;
    private final RepositorioCitas repositorio;
    private final LimitadorPeticiones limitador;
    private final Clock reloj;

    CitasAppApi(ClientesApp clientes, ReservaCitas reservas, CheckinCitas checkin, RepositorioCitas repositorio, LimitadorPeticiones limitador,
                Clock reloj) {
        this.clientes = clientes;
        this.reservas = reservas;
        this.checkin = checkin;
        this.repositorio = repositorio;
        this.limitador = limitador;
        this.reloj = reloj;
    }

    /** Citas del cliente (próximas primero) y las sanciones vigentes por no presentarse. */
    @GetMapping
    RespuestaApi<MisCitas> mias(@RequestHeader(value = "Authorization", required = false) String autorizacion) {
        int cliente = clientes.exigirCliente(autorizacion);
        var ahora = reloj.instant();
        List<CitaApp> citas = repositorio.citasDeCliente(cliente, ahora, 30).stream().map(c -> {
            ZoneId zona = ZoneId.of(c.zonaHoraria());
            boolean activa = (c.estado() == EstadoCita.RESERVADA || c.estado() == EstadoCita.CONFIRMADA) && c.fin().isAfter(ahora);
            return new CitaApp(c.token(), c.estado().name(), c.inicio().toString(), ReservaCitas.FECHA_LARGA.format(c.inicio().atZone(zona)),
                    c.localSlug(), c.localNombre(), c.servicio(), c.codigoCheckin(), activa, c.tarde(), c.turnoToken(), c.turnoCodigo(), c.turnoEstado());
        }).toList();
        List<SancionApp> sanciones = repositorio.sancionesVigentes(cliente, ahora).stream()
                .map(s -> new SancionApp(s.localNombre(), s.hasta().toString(), DateTimeFormatter.ofPattern("d/M 'a las' HH:mm")
                        .format(s.hasta().atZone(ZoneId.of(s.zonaHoraria()))), s.motivo()))
                .toList();
        return RespuestaApi.ok(new MisCitas(citas, sanciones));
    }

    /** Reserva a nombre de la cuenta (no pide nombre ni celular). Límite: 5 por minuto e IP. */
    @PostMapping
    ResponseEntity<RespuestaApi<ReservaCitas.VistaCita>> reservar(@RequestHeader(value = "Authorization", required = false) String autorizacion,
                                                                 @RequestBody PedidoCita b, HttpServletRequest peticion) {
        limitar("app-citas", 5, peticion);
        int cliente = clientes.exigirCliente(autorizacion);
        if (b == null || b.slug() == null || b.colaId() == null || b.slotId() == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan datos de la reserva", 422);
        }
        return RespuestaApi.creado(reservas.reservarPublica(b.slug(),
                new ReservaCitas.Solicitud(b.colaId(), b.slotId(), null, null, true, "APP", cliente)));
    }

    @DeleteMapping("/{token}")
    RespuestaApi<ReservaCitas.VistaCita> cancelar(@RequestHeader(value = "Authorization", required = false) String autorizacion,
                                                 @PathVariable String token) {
        propia(autorizacion, token);
        return RespuestaApi.ok(reservas.cancelarPorToken(token));
    }

    /** Check-in al llegar: la app manda la marca del QR «App» de la TV que acaba de escanear. Límite: 10 por minuto e IP. */
    @PostMapping("/{token}/checkin")
    RespuestaApi<CheckinCitas.Resultado> llegue(@RequestHeader(value = "Authorization", required = false) String autorizacion,
                                               @PathVariable String token, @RequestBody(required = false) Llegada b, HttpServletRequest peticion) {
        limitar("app-checkin", 10, peticion);
        Cita c = propia(autorizacion, token);
        if (b == null || !clientes.presenteEnElLocal(c.localId(), b.presencia())) {
            throw ErrorNegocio.prohibido("M3_PRESENCIA_INVALIDA", "Escanea el QR «App» de la pantalla del local para confirmar que llegaste");
        }
        return RespuestaApi.ok(checkin.checkin(token, null, true, "app"));
    }

    private Cita propia(String autorizacion, String token) {
        int cliente = clientes.exigirCliente(autorizacion);
        Cita c = reservas.exigirPorToken(token);
        if (c.clienteId() != cliente) {
            throw ErrorNegocio.noEncontrado("M3_CITA_NO_ENCONTRADA", "La cita no existe");
        }
        return c;
    }

    private void limitar(String clave, int maximo, HttpServletRequest peticion) {
        if (!limitador.permitir(clave, IpCliente.de(peticion), maximo)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
        }
    }

    record PedidoCita(String slug, Integer colaId, Integer slotId) {
    }

    record Llegada(String presencia) {
    }

    record CitaApp(String token, String estado, String inicio, String inicioTexto, String localSlug, String local, String servicio,
                   String codigoCheckin, boolean activa, boolean tarde, String turnoToken, String turnoCodigo, String turnoEstado) {
    }

    record SancionApp(String local, String hasta, String hastaTexto, String motivo) {
    }

    record MisCitas(List<CitaApp> citas, List<SancionApp> sanciones) {
    }
}
