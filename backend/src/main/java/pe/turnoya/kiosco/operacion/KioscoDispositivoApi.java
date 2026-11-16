package pe.turnoya.kiosco.operacion;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.citas.CheckinPresencial;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;

/**
 * API del dispositivo (M5): {@code /api/v1/kiosco/{emparejar,config,heartbeat,turnos,sync,mantenimiento,citas/checkin}} con el
 * token Bearer del kiosco, y {@code /api/v1/public/k/{dispositivo}/{fecha}/{seq}} para el QR del ticket provisional.
 */
@RestController
class KioscoDispositivoApi {

    private static final String AUTH = "Authorization";

    private final OperacionKiosco operacion;
    private final LimitadorPeticiones limitador;
    private final GeneradorQr qr;

    KioscoDispositivoApi(OperacionKiosco operacion, LimitadorPeticiones limitador, GeneradorQr qr) {
        this.operacion = operacion;
        this.limitador = limitador;
        this.qr = qr;
    }

    /** QR (SVG) para el ticket: el kiosco lo pide al emitir y precarga los de sus próximos tickets provisionales (sin red no hay QR). */
    @PostMapping("/api/v1/kiosco/qr")
    RespuestaApi<List<String>> qr(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody Textos b) {
        operacion.autenticar(auth);
        List<String> textos = b == null || b.textos() == null ? List.of() : b.textos();
        if (textos.size() > 30 || textos.stream().anyMatch(t -> t == null || t.length() > 300)) {
            throw new ErrorNegocio("VALIDACION", "Máximo 30 textos de hasta 300 caracteres", 422);
        }
        return RespuestaApi.ok(textos.stream().map(t -> qr.svg(t, 180)).toList());
    }

    record Textos(List<String> textos) {
    }

    @PostMapping("/api/v1/kiosco/emparejar")
    RespuestaApi<OperacionKiosco.Emparejado> emparejar(@RequestBody Emparejar b, HttpServletRequest peticion) {
        limitar("kiosco-emparejar", 5, peticion, "Demasiados intentos. Espera un minuto.");
        return RespuestaApi.ok(operacion.emparejar(b == null ? null : b.codigo()));
    }

    @GetMapping("/api/v1/kiosco/config")
    RespuestaApi<OperacionKiosco.Config> config(@RequestHeader(value = AUTH, required = false) String auth) {
        return RespuestaApi.ok(operacion.config(operacion.autenticar(auth).id()));
    }

    @PostMapping("/api/v1/kiosco/heartbeat")
    RespuestaApi<OperacionKiosco.Latido> latido(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody(required = false) Latido b) {
        var d = operacion.autenticar(auth);
        return RespuestaApi.ok(b == null ? operacion.latido(d, null, null, null, null)
                : operacion.latido(d, b.pendientes(), b.version(), b.impresora(), b.offsetMs()));
    }

    /** Emisión en línea idempotente por {@code claveIdem}: 201 si se aplicó, 200 si ya existía o quedó en revisión. */
    @PostMapping("/api/v1/kiosco/turnos")
    ResponseEntity<RespuestaApi<OperacionKiosco.Resultado>> turno(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody Turno b,
                                                                  HttpServletRequest peticion) {
        limitar("kiosco", 60, peticion, "Demasiadas solicitudes.");
        var d = operacion.autenticar(auth);
        if (b == null || b.colaId() == null) {
            throw new ErrorNegocio("VALIDACION", "Indica la cola", 422);
        }
        var r = operacion.aplicar(d, new OperacionKiosco.EventoEntrada(b.claveIdem(), b.seq(), "EMITIR_TURNO", b.tsDispositivo(),
                b.offsetMsAlEmitir() == null ? 0 : b.offsetMsAlEmitir(),
                new OperacionKiosco.Carga(b.colaId(), b.categoria(), b.nombre(), b.telefono(), b.consentimiento(), null)));
        return ResponseEntity.status("APLICADO".equals(r.estado()) ? 201 : 200).body(RespuestaApi.ok(r));
    }

    /** Lote de hasta 100 eventos offline; cada uno idempotente (§6.4). */
    @PostMapping("/api/v1/kiosco/sync")
    RespuestaApi<OperacionKiosco.Lote> sync(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody Sync b, HttpServletRequest peticion) {
        limitar("kiosco-sync", 60, peticion, "Demasiadas solicitudes.");
        var d = operacion.autenticar(auth);
        return RespuestaApi.ok(operacion.sincronizar(d, b == null || b.eventos() == null ? List.of() : b.eventos()));
    }

    @PostMapping("/api/v1/kiosco/mantenimiento")
    RespuestaApi<Map<String, Boolean>> mantenimiento(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody Pin b,
                                                     HttpServletRequest peticion) {
        limitar("kiosco-pin", 5, peticion, "Demasiados intentos.");
        var d = operacion.autenticar(auth);
        if (b == null || b.pin() == null || !b.pin().matches("\\d{4,8}")) {
            throw new ErrorNegocio("VALIDACION", "El PIN tiene de 4 a 8 dígitos", 422);
        }
        return RespuestaApi.ok(Map.of("valido", operacion.pinValido(d, b.pin())));
    }

    /** Check-in de cita por código o QR: estar frente al kiosco prueba presencia (sin PIN). */
    @PostMapping("/api/v1/kiosco/citas/checkin")
    RespuestaApi<CheckinPresencial.Resultado> checkinCita(@RequestHeader(value = AUTH, required = false) String auth, @RequestBody CodigoCita b) {
        var d = operacion.autenticar(auth);
        return RespuestaApi.ok(operacion.checkinCita(d, b == null ? null : b.codigo()));
    }

    @GetMapping("/api/v1/public/k/{dispositivo}/{fecha}/{seq}")
    RespuestaApi<OperacionKiosco.Provisional> provisional(@PathVariable int dispositivo, @PathVariable String fecha, @PathVariable int seq,
                                                         HttpServletRequest peticion) {
        limitar("k", 30, peticion, "Demasiadas solicitudes.");
        if (!fecha.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new ErrorNegocio("VALIDACION", "Fecha inválida", 422);
        }
        return RespuestaApi.ok(operacion.resolverProvisional(dispositivo, LocalDate.parse(fecha), seq));
    }

    private void limitar(String clave, int maximo, HttpServletRequest peticion, String mensaje) {
        if (!limitador.permitir(clave, IpCliente.de(peticion), maximo)) {
            throw new ErrorNegocio("RATE_LIMIT", mensaje, 429);
        }
    }

    record Emparejar(String codigo) {
    }

    record Latido(String estado, Integer pendientes, String version, String impresora, Double offsetMs) {
    }

    record Turno(String claveIdem, Integer seq, String tsDispositivo, Integer offsetMsAlEmitir, Integer colaId, String categoria, String nombre,
                 String telefono, Boolean consentimiento) {
    }

    record Sync(List<OperacionKiosco.EventoEntrada> eventos) {
    }

    record Pin(String pin) {
    }

    record CodigoCita(String codigo) {
    }

    /** Jobs de M5 (mismos nombres que el sistema anterior). */
    @Configuration(proxyBeanMethods = false)
    static class Tareas {

        @Bean
        TareaProgramada kioscoVigilancia(OperacionKiosco o) {
            return TareaProgramada.cada("kiosco-vigilancia", Duration.ofSeconds(60), "M5: marca sin conexión los kioscos sin latido en 75 s", o::jobVigilancia);
        }

        @Bean
        TareaProgramada kioscoLimpieza(OperacionKiosco o) {
            return TareaProgramada.diaria("kiosco-limpieza", LocalTime.of(4, 15), "M5: borra eventos sincronizados de más de 30 días", o::jobLimpieza);
        }
    }
}
