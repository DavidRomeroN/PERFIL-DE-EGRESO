package pe.turnoya.nucleo.appmovil;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.nucleo.TurnoPublico;
import pe.turnoya.nucleo.dominio.RepositorioApp.TurnoDeCliente;

/**
 * {@code /api/v1/public/app/**}: cuenta del cliente en la app móvil. Sin sesión web: la app se identifica con el
 * token que recibe al registrarse o ingresar con su correo, o al verificar su celular ({@code Authorization: Bearer …}).
 */
@RestController
@RequestMapping("/api/v1/public/app")
class AppApi {

    private final CuentasApp cuentas;
    private final TurnosApp turnos;
    private final PerfilApp perfiles;
    private final LimitadorPeticiones limitador;

    AppApi(CuentasApp cuentas, TurnosApp turnos, PerfilApp perfiles, LimitadorPeticiones limitador) {
        this.perfiles = perfiles;
        this.cuentas = cuentas;
        this.turnos = turnos;
        this.limitador = limitador;
    }

    /**
     * Tomar turno desde la app: exige la marca de presencia del QR de la TV y el identificador del dispositivo; con
     * sesión, el turno queda a nombre del cliente. Límite: 5 por minuto e IP.
     */
    @PostMapping("/turnos")
    ResponseEntity<RespuestaApi<TurnoPublico>> tomar(@Valid @RequestBody PedidoTurno pedido,
                                                     @RequestHeader(value = "Authorization", required = false) String autorizacion,
                                                     HttpServletRequest peticion) {
        limitar("turnos", peticion, 5);
        return RespuestaApi.creado(turnos.tomar(new TurnosApp.Pedido(pedido.colaId(), pedido.nombre(), pedido.categoriaCodigo(), pedido.presencia(),
                pedido.dispositivo(), autorizacion)));
    }

    /** Envía el código de 6 dígitos por WhatsApp. Límite: 3 por minuto e IP, y uno por minuto y celular. */
    @PostMapping("/codigo")
    RespuestaApi<Map<String, Object>> codigo(@Valid @RequestBody PedidoCodigo pedido, HttpServletRequest peticion) {
        limitar("app-codigo", peticion, 3);
        cuentas.pedirCodigo(pedido.slug(), pedido.telefono());
        return RespuestaApi.ok(Map.of("enviado", true, "venceEnMin", 10));
    }

    /** Verifica el código y abre la sesión. Límite: 10 por minuto e IP, y 5 intentos por código. */
    @PostMapping("/sesion")
    ResponseEntity<RespuestaApi<CuentasApp.SesionAbierta>> abrir(@Valid @RequestBody PedidoSesion pedido, HttpServletRequest peticion) {
        limitar("app-sesion", peticion, 10);
        return RespuestaApi.creado(cuentas.verificar(pedido.telefono(), pedido.codigo(), pedido.nombre(),
                Boolean.TRUE.equals(pedido.consentimiento()), pedido.dispositivo()));
    }

    /** Crea la cuenta con correo y contraseña. Límite: 5 por minuto e IP. */
    @PostMapping("/registro")
    ResponseEntity<RespuestaApi<CuentasApp.SesionAbierta>> registrar(@Valid @RequestBody PedidoRegistro pedido, HttpServletRequest peticion) {
        limitar("app-registro", peticion, 5);
        return RespuestaApi.creado(cuentas.registrar(pedido.correo(), pedido.clave(), pedido.nombre(), Boolean.TRUE.equals(pedido.consentimiento()),
                pedido.dispositivo()));
    }

    /** Ingresa con correo y contraseña. Límite: 10 por minuto e IP; la cuenta se bloquea 15 min tras 5 fallos. */
    @PostMapping("/ingreso")
    ResponseEntity<RespuestaApi<CuentasApp.SesionAbierta>> ingresar(@Valid @RequestBody PedidoIngreso pedido, HttpServletRequest peticion) {
        limitar("app-ingreso", peticion, 10);
        return RespuestaApi.creado(cuentas.ingresar(pedido.correo(), pedido.clave(), pedido.dispositivo()));
    }

    /** Datos de la cuenta y estado antifraude (faltas, bloqueo, turnos activos). */
    @GetMapping("/perfil")
    RespuestaApi<PerfilApp.Perfil> perfil(@RequestHeader(value = "Authorization", required = false) String autorizacion,
                                         @RequestHeader(value = "X-Dispositivo", required = false) String dispositivo) {
        return RespuestaApi.ok(perfiles.de(autorizacion, dispositivo));
    }

    @DeleteMapping("/sesion")
    RespuestaApi<Map<String, Boolean>> cerrar(@RequestHeader(value = "Authorization", required = false) String autorizacion) {
        cuentas.cerrar(autorizacion);
        return RespuestaApi.ok(Map.of("cerrada", true));
    }

    /** Últimos turnos del cliente en todos los locales; el token de seguimiento solo sale en los activos. */
    @GetMapping("/turnos")
    RespuestaApi<List<TurnoDeCliente>> turnos(@RequestHeader(value = "Authorization", required = false) String autorizacion) {
        return RespuestaApi.ok(cuentas.historial(autorizacion));
    }

    private void limitar(String clave, HttpServletRequest peticion, int maximo) {
        if (!limitador.permitir(clave, IpCliente.de(peticion), maximo)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
        }
    }

    record PedidoTurno(@NotNull @Positive Integer colaId, @Size(max = 60) String nombre, @Size(max = 40) String categoriaCodigo,
                       @Size(max = 64) String presencia, @Size(max = 64) String dispositivo) {
    }

    record PedidoCodigo(@NotBlank @Size(max = 63) String slug, @NotBlank @Size(max = 20) String telefono) {
    }

    record PedidoSesion(@NotBlank @Size(max = 20) String telefono, @NotBlank @Size(max = 12) String codigo, @Size(max = 60) String nombre,
                        Boolean consentimiento, @Size(max = 64) String dispositivo) {
    }

    record PedidoRegistro(@NotBlank @Size(max = 120) String correo, @NotBlank @Size(max = 72) String clave, @Size(max = 60) String nombre,
                          Boolean consentimiento, @Size(max = 64) String dispositivo) {
    }

    record PedidoIngreso(@NotBlank @Size(max = 120) String correo, @NotBlank @Size(max = 72) String clave, @Size(max = 64) String dispositivo) {
    }

    @Configuration(proxyBeanMethods = false)
    static class Tareas {

        @Bean
        TareaProgramada appLimpiarCodigos(CuentasApp cuentas) {
            return TareaProgramada.diaria("app-limpiar-codigos", LocalTime.of(4, 15), "App móvil: códigos de verificación vencidos", cuentas::limpiar);
        }
    }
}
