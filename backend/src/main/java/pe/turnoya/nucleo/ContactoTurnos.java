package pe.turnoya.nucleo;

import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.nucleo.infraestructura.ClientesJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.infraestructura.VentanillasJdbc;
import pe.turnoya.plataforma.CatalogoLocales;

/**
 * Datos de contacto de un turno para avisarle (módulo notificaciones). Los eventos no llevan el celular: se
 * descifra aquí, solo en el momento de enviar.
 */
@Service
@Transactional(readOnly = true)
public class ContactoTurnos {

    private final TurnosJdbc turnos;
    private final ClientesJdbc clientes;
    private final VentanillasJdbc ventanillas;
    private final CatalogoLocales locales;
    private final CifradoDatos cifrado;

    ContactoTurnos(TurnosJdbc turnos, ClientesJdbc clientes, VentanillasJdbc ventanillas, CatalogoLocales locales, CifradoDatos cifrado) {
        this.turnos = turnos;
        this.clientes = clientes;
        this.ventanillas = ventanillas;
        this.locales = locales;
        this.cifrado = cifrado;
    }

    public Optional<Contacto> de(int turnoId) {
        return turnos.porId(turnoId).map(t -> {
            var datos = t.clienteId() == null ? null : clientes.datos(t.clienteId()).orElse(null);
            String telefono = datos == null ? null : cifrado.descifrar(datos.telefonoCifrado()).orElse(null);
            String ventanilla = t.ventanillaId() == null ? null
                    : ventanillas.porIdEnLocal(t.ventanillaId(), t.localId()).map(v -> v.nombre()).orElse(null);
            return new Contacto(t.id(), t.localId(), t.codigo(), t.token(), datos == null ? null : datos.nombre(), telefono,
                    locales.exigir(t.localId()).nombreComercial(), ventanilla);
        });
    }

    /** {@code telefonoE164} nulo si el cliente no dejó celular (el aviso queda solo en la web). */
    public record Contacto(int turnoId, int localId, String codigo, String token, String nombre, String telefonoE164,
                           String localNombre, String ventanilla) {
    }
}
