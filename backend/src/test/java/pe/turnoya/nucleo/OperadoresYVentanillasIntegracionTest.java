package pe.turnoya.nucleo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.atencion.AccesoVentanillas;
import pe.turnoya.nucleo.colas.GestionColas;
import pe.turnoya.nucleo.ventanillas.GestionVentanillas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.usuarios.GestionUsuarios;

/**
 * Modelo simplificado: una ventanilla por cola, y cada operador solo opera las ventanillas que le asignó el
 * administrador (por ejemplo, una cuenta solo para el odontólogo).
 */
@SpringBootTest(properties = {
        "turnoya.jobs-habilitados=false",
        "turnoya.seguridad.jwt-secret=secreto-de-pruebas-turnoya-0123456789abcdef",
        "turnoya.seguridad.data-encryption-key=clave-de-pruebas-turnoya-0123456789abcdef",
})
@Testcontainers(disabledWithoutDocker = true)
class OperadoresYVentanillasIntegracionTest {

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    @DynamicPropertySource
    static void baseDeDatos(DynamicPropertyRegistry registro) {
        registro.add("turnoya.database-url", () -> "postgresql://" + POSTGRES.getUsername() + ":" + POSTGRES.getPassword() + "@"
                + POSTGRES.getHost() + ":" + POSTGRES.getMappedPort(5432) + "/" + POSTGRES.getDatabaseName() + "?schema=public");
    }

    @Autowired
    JdbcClient jdbc;
    @Autowired
    GestionColas colas;
    @Autowired
    GestionVentanillas ventanillas;
    @Autowired
    GestionUsuarios usuarios;
    @Autowired
    AccesoVentanillas acceso;
    @Autowired
    TomaDeTurnos toma;

    private int localId;
    private int medicina;
    private int odontologia;
    private int ventanillaMedicina;
    private int ventanillaOdontologia;

    @BeforeEach
    void crearLocal() {
        String slug = "prueba-" + System.nanoTime();
        int planId = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                                          whatsapp_habilitado, max_avisos_whatsapp)
                        VALUES (:codigo, 'Pro', 0, 10000, 10, 10, false, 0) RETURNING id""")
                .param("codigo", "PRO-" + slug).query(Integer.class).single();
        localId = jdbc.sql("""
                        INSERT INTO local (slug, razon_social, nombre_comercial, plan_id)
                        VALUES (:slug, 'Prueba SAC', 'Policlínico de prueba', :plan) RETURNING id""")
                .param("slug", slug).param("plan", planId).query(Integer.class).single();
        medicina = colas.crear(localId, new GestionColas.DatosCola("A", "Medicina", null, null, true, 1), Auditoria.Actor.SISTEMA).id();
        odontologia = colas.crear(localId, new GestionColas.DatosCola("D", "Odontología", null, null, true, 2), Auditoria.Actor.SISTEMA).id();
        ventanillaMedicina = ventanillaDe(medicina);
        ventanillaOdontologia = ventanillaDe(odontologia);
    }

    @Test
    void cadaColaTraeSuVentanillaYNoAdmiteOtra() {
        assertThat(ventanillas.listar(localId)).extracting(GestionVentanillas.VentanillaAdmin::nombre)
                .containsExactlyInAnyOrder("Medicina", "Odontología");
        assertThatThrownBy(() -> ventanillas.crear(localId, new GestionVentanillas.DatosVentanilla("Consultorio 2", medicina, true),
                Auditoria.Actor.SISTEMA))
                .extracting(e -> ((ErrorNegocio) e).codigo()).isEqualTo("COLA_CON_VENTANILLA");
        assertThatThrownBy(() -> ventanillas.crear(localId, new GestionVentanillas.DatosVentanilla("General", null, true),
                Auditoria.Actor.SISTEMA))
                .extracting(e -> ((ErrorNegocio) e).codigo()).isEqualTo("VALIDACION");
    }

    @Test
    void desactivarLaColaDesactivaSuVentanilla() {
        colas.eliminar(localId, medicina, Auditoria.Actor.SISTEMA);
        assertThat(ventanillas.listar(localId)).extracting(GestionVentanillas.VentanillaAdmin::nombre).containsExactly("Odontología");
    }

    @Test
    void elOdontologoSoloOperaSuVentanilla() {
        var odontologo = usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Dr. Pérez", "odonto-" + localId + "@prueba.pe",
                "secreto123", RolUsuario.OPERADOR, true, List.of(ventanillaOdontologia)), Auditoria.Actor.SISTEMA);
        Sesion sesion = new Sesion(odontologo.id(), odontologo.email(), odontologo.nombre(), RolUsuario.OPERADOR, localId, null, null);

        assertThat(acceso.permitidas(sesion)).containsExactly(ventanillaOdontologia);
        assertThatCode(() -> acceso.exigirVentanilla(sesion, ventanillaOdontologia)).doesNotThrowAnyException();
        assertThatCode(() -> acceso.exigirCola(sesion, localId, odontologia)).doesNotThrowAnyException();
        assertThatThrownBy(() -> acceso.exigirVentanilla(sesion, ventanillaMedicina))
                .extracting(e -> ((ErrorNegocio) e).codigo()).isEqualTo("SIN_PERMISO");
        assertThatThrownBy(() -> acceso.exigirCola(sesion, localId, medicina))
                .extracting(e -> ((ErrorNegocio) e).codigo()).isEqualTo("SIN_PERMISO");
    }

    @Test
    void unOperadorPuedeTenerVariasVentanillasPeroAlMenosUna() {
        var recepcion = usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Recepción", "recepcion-" + localId + "@prueba.pe",
                "secreto123", RolUsuario.OPERADOR, true, List.of(ventanillaMedicina, ventanillaOdontologia)), Auditoria.Actor.SISTEMA);
        assertThat(usuarios.asignaciones(localId).get(recepcion.id())).containsExactlyInAnyOrder(ventanillaMedicina, ventanillaOdontologia);

        assertThatThrownBy(() -> usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Sin puesto", "sin-" + localId + "@prueba.pe",
                "secreto123", RolUsuario.OPERADOR, true, List.of()), Auditoria.Actor.SISTEMA))
                .hasMessageContaining("al menos una ventanilla");

        // Un administrador no lleva ventanillas: opera todas
        var admin = usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Admin", "admin-" + localId + "@prueba.pe",
                "secreto123", RolUsuario.ADMIN_LOCAL, true, List.of(ventanillaMedicina)), Auditoria.Actor.SISTEMA);
        assertThat(usuarios.asignaciones(localId)).doesNotContainKey(admin.id());
        assertThat(acceso.permitidas(new Sesion(admin.id(), admin.email(), admin.nombre(), RolUsuario.ADMIN_LOCAL, localId, null, null))).isNull();
    }

    @Test
    void elKioscoNoLlevaVentanillasYEmiteTicketsParaCualquierCola() {
        var kiosco = usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Recepción", "kiosco-" + localId + "@prueba.pe",
                "secreto123", RolUsuario.KIOSCO, true, List.of(ventanillaMedicina)), Auditoria.Actor.SISTEMA);
        assertThat(usuarios.asignaciones(localId)).doesNotContainKey(kiosco.id());
        assertThat(RolUsuario.KIOSCO.esAdmin()).isFalse();
        assertThat(RolUsuario.KIOSCO.inicio()).isEqualTo("/panel-kiosco");

        assertThat(toma.ticketDeRecepcion(localId, medicina, "Ana", null).codigo()).isEqualTo("A-001");
        assertThat(toma.ticketDeRecepcion(localId, odontologia, null, null).codigo()).isEqualTo("D-001");
    }

    private int ventanillaDe(int colaId) {
        return ventanillas.listar(localId).stream().filter(v -> v.colaId() != null && v.colaId() == colaId).findFirst().orElseThrow().id();
    }
}
