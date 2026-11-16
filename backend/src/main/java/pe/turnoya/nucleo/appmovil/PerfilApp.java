package pe.turnoya.nucleo.appmovil;

import java.time.Instant;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.nucleo.dominio.RepositorioApp;

/**
 * Perfil del cliente en la app: sus datos (el teléfono enmascarado) y su estado antifraude —faltas de los últimos días,
 * si está bloqueado y hasta cuándo, y cuántos turnos activos tiene—, para que vea por qué no puede tomar turno.
 */
@Service
public class PerfilApp {

    private final CuentasApp cuentas;
    private final TurnosApp turnos;
    private final RepositorioApp repositorio;
    private final CifradoDatos cifrado;

    PerfilApp(CuentasApp cuentas, TurnosApp turnos, RepositorioApp repositorio, CifradoDatos cifrado) {
        this.cuentas = cuentas;
        this.turnos = turnos;
        this.repositorio = repositorio;
        this.cifrado = cifrado;
    }

    public record Perfil(String nombre, String correo, String telefono, Instant miembroDesde, TurnosApp.Conducta conducta) {
    }

    /** {@code dispositivo}: el identificador de la app (opcional); suma las faltas de ese teléfono a las de la cuenta. */
    public Perfil de(String autorizacion, String dispositivo) {
        int clienteId = cuentas.exigirCliente(autorizacion);
        RepositorioApp.DatosCliente datos = repositorio.datosCliente(clienteId)
                .orElseThrow(() -> new ErrorNegocio("APP_SESION_INVALIDA", "Tu sesión terminó. Vuelve a ingresar.", 401));
        String telefono = datos.telefonoCifrado() == null ? null
                : cifrado.descifrar(datos.telefonoCifrado()).map(Telefonos::enmascarar).orElse(null);
        String dispositivoHash = dispositivo == null || dispositivo.isBlank() ? null : CuentasApp.hashDispositivo(dispositivo);
        return new Perfil(datos.nombre(), datos.correo(), telefono, datos.creado(), turnos.conducta(dispositivoHash, clienteId));
    }
}
