package pe.turnoya.citas.reserva;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.checkin.CheckinCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.Idempotencia;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.ClavePantalla;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Sesion;

/** API pública de M3: servicios, días, horarios, reservar, ver, confirmar, cancelar, reprogramar, check-in, .ics y PIN de la TV. */
@RestController
class CitasPublicasApi {

    private final ReservaCitas reservas;
    private final DisponibilidadCitas disponibilidad;
    private final CheckinCitas checkin;
    private final CatalogoLocales locales;
    private final ModulosLocal modulos;
    private final ClavePantalla clavePantalla;
    private final Idempotencia idempotencia;
    private final LimitadorPeticiones limitador;

    CitasPublicasApi(ReservaCitas reservas, DisponibilidadCitas disponibilidad, CheckinCitas checkin, CatalogoLocales locales, ModulosLocal modulos,
                     ClavePantalla clavePantalla, Idempotencia idempotencia, LimitadorPeticiones limitador) {
        this.reservas = reservas;
        this.disponibilidad = disponibilidad;
        this.checkin = checkin;
        this.locales = locales;
        this.modulos = modulos;
        this.clavePantalla = clavePantalla;
        this.idempotencia = idempotencia;
        this.limitador = limitador;
    }

    @GetMapping("/api/v1/public/locales/{slug}/citas")
    RespuestaApi<DisponibilidadCitas.Servicios> servicios(@PathVariable String slug) {
        return RespuestaApi.ok(disponibilidad.servicios(slug));
    }

    @GetMapping("/api/v1/public/locales/{slug}/disponibilidad")
    RespuestaApi<List<DisponibilidadCitas.DiaDisponible>> dias(@PathVariable String slug, @RequestParam(required = false) Integer colaId,
                                                              @RequestParam(required = false) Integer dias, HttpServletRequest peticion) {
        limitar("disponibilidad", 30, peticion);
        if (colaId == null || colaId <= 0) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola", 422);
        }
        Local local = disponibilidad.localPublico(slug);
        return RespuestaApi.ok(disponibilidad.disponibilidad(local, colaId, Math.max(1, Math.min(14, dias == null ? 14 : dias))));
    }

    @GetMapping("/api/v1/public/locales/{slug}/slots")
    RespuestaApi<List<DisponibilidadCitas.SlotPublico>> slots(@PathVariable String slug, @RequestParam(required = false) Integer colaId,
                                                             @RequestParam(required = false) String fecha, HttpServletRequest peticion) {
        limitar("slots", 60, peticion);
        if (colaId == null || colaId <= 0 || fecha == null || !fecha.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola y la fecha", 422);
        }
        Local local = disponibilidad.localPublico(slug);
        return RespuestaApi.ok(disponibilidad.slotsDelDia(local, colaId, LocalDate.parse(fecha)));
    }

    /** PIN para la TV: exige la clave de pantalla ({@code ?k=}) o una sesión del mismo local. */
    @GetMapping("/api/v1/public/locales/{slug}/pin-presencia")
    RespuestaApi<CheckinCitas.Pin> pin(@PathVariable String slug, @RequestParam(required = false) String k, @AuthenticationPrincipal Sesion sesion) {
        Local local = locales.porSlug(slug).orElseThrow(() -> ErrorNegocio.noEncontrado("LOCAL_NO_ENCONTRADO", "El local no existe"));
        boolean autorizado = clavePantalla.valida(local.id(), k)
                || (sesion != null && (sesion.esSuperAdmin() || Integer.valueOf(local.id()).equals(sesion.localId())));
        if (!autorizado) {
            throw ErrorNegocio.prohibido("PROHIBIDO", "Enlace de pantalla inválido");
        }
        return RespuestaApi.ok(modulos.activo(local.id(), Modulo.M3) ? checkin.pinActual(local.id()) : null);
    }

    /** Reserva atómica sin sobrecupo; acepta {@code Idempotency-Key} (RNF-M3-03). */
    @PostMapping("/api/v1/public/citas")
    ResponseEntity<?> reservar(@RequestBody PedidoCita b, @RequestHeader(value = "Idempotency-Key", required = false) String clave,
                               HttpServletRequest peticion) {
        limitar("citas", 5, peticion);
        if (b == null || b.slug() == null || b.colaId() == null || b.slotId() == null || b.nombre() == null) {
            throw new ErrorNegocio("VALIDACION", "Faltan datos de la reserva", 422);
        }
        String nombre = b.nombre().trim();
        if (nombre.length() < 2 || nombre.length() > 60) {
            throw new ErrorNegocio("VALIDACION", "El nombre debe tener de 2 a 60 caracteres", 422);
        }
        String telefono = b.telefono() == null || b.telefono().isBlank() ? null : b.telefono().trim();
        if (telefono != null && telefono.length() > 20) {
            throw new ErrorNegocio("VALIDACION", "Celular inválido", 422);
        }
        var s = new ReservaCitas.Solicitud(b.colaId(), b.slotId(), nombre, telefono, Boolean.TRUE.equals(b.consentimiento()), "WEB", null);
        return idempotencia.ejecutar(clave, "POST /public/citas", 201, () -> reservas.reservarPublica(b.slug(), s));
    }

    @GetMapping("/api/v1/public/citas/{token}")
    RespuestaApi<ReservaCitas.VistaCita> obtener(@PathVariable String token) {
        return RespuestaApi.ok(reservas.obtener(token));
    }

    @DeleteMapping("/api/v1/public/citas/{token}")
    RespuestaApi<ReservaCitas.VistaCita> cancelar(@PathVariable String token, HttpServletRequest peticion) {
        limitar("cita-cancelar", 10, peticion);
        return RespuestaApi.ok(reservas.cancelarPorToken(token));
    }

    @PostMapping("/api/v1/public/citas/{token}/confirmar")
    RespuestaApi<ReservaCitas.VistaCita> confirmar(@PathVariable String token, HttpServletRequest peticion) {
        limitar("cita-confirmar", 10, peticion);
        return RespuestaApi.ok(reservas.confirmar(token));
    }

    @PostMapping("/api/v1/public/citas/{token}/reprogramar")
    RespuestaApi<ReservaCitas.VistaCita> reprogramar(@PathVariable String token, @RequestBody Reprogramar b, HttpServletRequest peticion) {
        limitar("cita-reprogramar", 10, peticion);
        if (b == null || b.slotId() == null || b.slotId() <= 0) {
            throw new ErrorNegocio("VALIDACION", "Indica el nuevo horario", 422);
        }
        return RespuestaApi.ok(reservas.reprogramarPorToken(token, b.slotId()));
    }

    @PostMapping("/api/v1/public/citas/{token}/checkin")
    RespuestaApi<CheckinCitas.Resultado> checkin(@PathVariable String token, @RequestBody Checkin b, HttpServletRequest peticion) {
        limitar("checkin", 10, peticion);
        String pin = b == null || b.pin() == null ? "" : b.pin().trim();
        if (!pin.matches("\\d{4}")) {
            throw new ErrorNegocio("VALIDACION", "El PIN tiene 4 dígitos", 422);
        }
        return RespuestaApi.ok(checkin.checkin(token, pin, false, null));
    }

    @GetMapping("/api/v1/public/citas/{token}/ics")
    ResponseEntity<byte[]> ics(@PathVariable String token) {
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "calendar", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"cita-" + token.replaceAll("[^A-Za-z0-9]", "") + ".ics\"")
                .body(reservas.ics(token).getBytes(StandardCharsets.UTF_8));
    }

    private void limitar(String clave, int maximo, HttpServletRequest peticion) {
        if (!limitador.permitir(clave, IpCliente.de(peticion), maximo)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
    }

    record PedidoCita(String slug, Integer colaId, Integer slotId, String nombre, String telefono, Boolean consentimiento) {
    }

    record Reprogramar(Integer slotId) {
    }

    record Checkin(String pin) {
    }
}
