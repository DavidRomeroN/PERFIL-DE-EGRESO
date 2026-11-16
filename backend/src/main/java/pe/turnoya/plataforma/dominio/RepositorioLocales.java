package pe.turnoya.plataforma.dominio;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/** Puerto de salida: Locales (tenants) y sus planes. Lo implementa {@code infraestructura.LocalesJdbc}. */
public interface RepositorioLocales {

    Optional<Local> porSlug(String slug);

    Optional<Local> porId(int id);

    List<Local> activos();

    Plan plan(int planId);

    /** RUC del local (no forma parte de {@link Local}: solo lo usa la configuración). */
    String ruc(int id);

    void actualizarNegocio(int id, DatosNegocio datos);

    void actualizarPantalla(int id, DatosPantalla datos);

    /** Segundos para marcar "no se presentó" a un turno llamado; {@code null} desactiva la expiración (RN04). */
    void actualizarAusencia(int id, Integer segundos);

    /** Consumo del local desde {@code desde} (inicio del mes): turnos, avisos de WhatsApp y recursos creados. */
    UsoLocal uso(int id, Instant desde);

    record DatosNegocio(String nombreComercial, String razonSocial, String ruc, String rubro, String direccion, String telefono) {
    }

    record DatosPantalla(String colorPrimario, String logoUrl, String mensajeTv, String mensajeBienvenida, int avisarFaltando) {
    }

    record UsoLocal(int turnosMes, int avisosMes, int colas, int ventanillas, int usuarios) {
    }

    /** Todos los locales (activos o no) con su uso, para el super admin. */
    List<LocalResumen> todosConUso(Instant inicioMes);

    boolean existeSlug(String slug);

    int crear(AltaLocal alta);

    void editar(int id, AltaLocal datos);

    void activar(int id, boolean activo);

    /** Datos de alta o edición de un local (super admin y registro público). */
    record AltaLocal(String slug, String nombreComercial, String razonSocial, String ruc, String rubro, String direccion, String telefono,
                     String ciudad, int planId, String colorPrimario, java.time.Instant planVenceAt) {
    }

    record LocalResumen(Local local, String ruc, String plan, int colas, int ventanillas, int usuarios, int turnosMes) {
    }
}
