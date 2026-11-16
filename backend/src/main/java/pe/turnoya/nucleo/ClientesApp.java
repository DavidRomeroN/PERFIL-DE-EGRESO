package pe.turnoya.nucleo;

import java.util.Optional;
import org.springframework.stereotype.Service;
import pe.turnoya.nucleo.appmovil.CuentasApp;
import pe.turnoya.nucleo.appmovil.PresenciaApp;

/**
 * Lo que otros módulos necesitan de la app móvil del cliente: quién es por su token de sesión
 * ({@code Authorization: Bearer …}) y si escaneó el QR «App» de la TV del local (prueba de que está ahí).
 */
@Service
public class ClientesApp {

    private final CuentasApp cuentas;
    private final PresenciaApp presencia;

    ClientesApp(CuentasApp cuentas, PresenciaApp presencia) {
        this.cuentas = cuentas;
        this.presencia = presencia;
    }

    public Optional<Integer> cliente(String autorizacion) {
        return cuentas.clienteDe(autorizacion);
    }

    /** Lanza {@code APP_SESION_INVALIDA} (401) si no hay sesión válida. */
    public int exigirCliente(String autorizacion) {
        return cuentas.exigirCliente(autorizacion);
    }

    /** La marca del QR «App» de la TV es la vigente de este local (cambia cada 5 min). */
    public boolean presenteEnElLocal(int localId, String marca) {
        return marca != null && presencia.valida(localId, marca);
    }
}
