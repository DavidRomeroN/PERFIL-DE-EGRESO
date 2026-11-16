package pe.turnoya;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.ContactoTurnos;
import pe.turnoya.nucleo.TomaDeTurnos;
import pe.turnoya.nucleo.colas.GestionColas;
import pe.turnoya.nucleo.ventanillas.GestionVentanillas;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.usuarios.GestionUsuarios;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Negocios pequeños: tickets con el celular del cliente (aviso por WhatsApp
 * sin app) y la app móvil del personal con token Bearer que solo ve sus ventanillas.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "turnoya.jobs-habilitados=false",
        "turnoya.seguridad.jwt-secret=secreto-de-pruebas-turnoya-0123456789abcdef",
        "turnoya.seguridad.data-encryption-key=clave-de-pruebas-turnoya-0123456789abcdef",
})
@Testcontainers(disabledWithoutDocker = true)
class NegociosPequenosIntegracionTest {

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    @DynamicPropertySource
    static void baseDeDatos(DynamicPropertyRegistry registro) {
        registro.add("turnoya.database-url", () -> "postgresql://" + POSTGRES.getUsername() + ":" + POSTGRES.getPassword() + "@"
                + POSTGRES.getHost() + ":" + POSTGRES.getMappedPort(5432) + "/" + POSTGRES.getDatabaseName() + "?schema=public");
    }

    @LocalServerPort
    int puerto;
    @Autowired
    JdbcClient jdbc;
    @Autowired
    GestionColas colas;
    @Autowired
    GestionVentanillas ventanillas;
    @Autowired
    GestionUsuarios usuarios;
    @Autowired
    TomaDeTurnos toma;
    @Autowired
    ContactoTurnos contactos;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper json = new ObjectMapper();

    private int localId;
    private int ventanillaRios;
    private int ventanillaParedes;
    private int colaRios;
    private String sufijo;

    @BeforeEach
    void crearClinica() {
        sufijo = Long.toString(System.nanoTime(), 36);
        int emprende = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                                          whatsapp_habilitado, max_avisos_whatsapp)
                        VALUES (:codigo, 'Emprende', 49, 5000, 3, 3, true, 1000) RETURNING id""")
                .param("codigo", "EMP-" + sufijo).query(Integer.class).single();
        localId = jdbc.sql("""
                        INSERT INTO local (slug, razon_social, nombre_comercial, plan_id)
                        VALUES (:slug, 'Dental SAC', 'Dental Sonrisa', :plan) RETURNING id""")
                .param("slug", "dental-" + sufijo).param("plan", emprende).query(Integer.class).single();
        colaRios = colas.crear(localId, new GestionColas.DatosCola("R", "Dra. Ríos", null, null, true, 1), Auditoria.Actor.SISTEMA).id();
        int colaParedes = colas.crear(localId, new GestionColas.DatosCola("P", "Dr. Paredes", null, null, true, 2), Auditoria.Actor.SISTEMA).id();
        ventanillaRios = ventanillaDe(colaRios);
        ventanillaParedes = ventanillaDe(colaParedes);
    }

    @Test
    void renombrarUnaVentanillaConservaSuCola() {
        ventanillas.editar(localId, ventanillaRios, new GestionVentanillas.CambiosVentanilla("Consultorio 1", Optional.empty(), null),
                Auditoria.Actor.SISTEMA);
        assertThat(ventanillas.listar(localId)).filteredOn(v -> v.id() == ventanillaRios).singleElement()
                .satisfies(v -> {
                    assertThat(v.nombre()).isEqualTo("Consultorio 1");
                    assertThat(v.colaId()).isEqualTo(colaRios);
                });
    }

    @Test
    void elTicketConCelularAvisaPorWhatsAppSinApp() throws InterruptedException {
        assertThatThrownBy(() -> toma.ticketDeRecepcion(localId, colaRios, "Ana", null, "951234567", false))
                .extracting(e -> ((ErrorNegocio) e).codigo()).isEqualTo("CONSENTIMIENTO_REQUERIDO");

        var turno = toma.ticketDeRecepcion(localId, colaRios, "Ana", null, "951234567", true);
        assertThat(contactos.de(turno.id())).get().extracting(ContactoTurnos.Contacto::telefonoE164).isEqualTo("+51951234567");

        // El aviso de confirmación sale tras confirmar la emisión (evento asíncrono)
        List<String> plantillas = List.of();
        for (int i = 0; i < 50 && !plantillas.contains("turno_emitido"); i++) {
            Thread.sleep(100);
            plantillas = jdbc.sql("SELECT plantilla FROM notificacion WHERE turno_id = :t").param("t", turno.id()).query(String.class).list();
        }
        assertThat(plantillas).contains("turno_emitido");
    }

    @Test
    void elOperadorYLaRecepcionIngresanDesdeLaApp() throws Exception {
        usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Dra. Ríos", "rios-" + sufijo + "@prueba.pe", "operador123", RolUsuario.OPERADOR,
                true, List.of(ventanillaRios)), Auditoria.Actor.SISTEMA);
        usuarios.crear(localId, new GestionUsuarios.DatosUsuario("Recepción", "kiosco-" + sufijo + "@prueba.pe", "kiosco123", RolUsuario.KIOSCO,
                true, List.of()), Auditoria.Actor.SISTEMA);

        JsonNode ingreso = pedir("POST", "/api/v1/auth/movil", "{\"email\":\"rios-" + sufijo + "@prueba.pe\",\"password\":\"operador123\"}", null);
        assertThat(ingreso.path("ok").asBoolean()).isTrue();
        String token = ingreso.path("data").path("token").asString();

        JsonNode panel = pedir("GET", "/api/v1/movil/panel", null, token);
        assertThat(panel.path("data").path("ventanillas")).hasSize(1);
        assertThat(panel.path("data").path("ventanillas").get(0).path("id").asInt()).isEqualTo(ventanillaRios);

        // Con el token llama en su ventanilla, pero no en la del otro médico
        toma.ticketDeRecepcion(localId, colaRios, "Ana", null);
        assertThat(pedir("POST", "/api/v1/ventanillas/" + ventanillaRios + "/llamar-siguiente", null, token).path("ok").asBoolean()).isTrue();
        assertThat(pedir("POST", "/api/v1/ventanillas/" + ventanillaParedes + "/llamar-siguiente", null, token).path("error").path("codigo")
                .asString()).isEqualTo("SIN_PERMISO");

        // La recepción (kiosco) entra a la app: ve todas las colas y emite tickets, pero no llama turnos
        String kiosco = pedir("POST", "/api/v1/auth/movil", "{\"email\":\"kiosco-" + sufijo + "@prueba.pe\",\"password\":\"kiosco123\"}", null)
                .path("data").path("token").asString();
        JsonNode recepcion = pedir("GET", "/api/v1/movil/kiosco", null, kiosco).path("data");
        assertThat(recepcion.path("colas")).hasSize(2);
        assertThat(pedir("POST", "/api/v1/movil/kiosco/ticket", "{\"colaId\":" + colaRios + ",\"nombre\":\"Luis\"}", kiosco)
                .path("data").path("codigo").asString()).startsWith("R-");
        assertThat(pedir("GET", "/api/v1/movil/kiosco", null, kiosco).path("data").path("espera")).hasSize(1);
        assertThat(pedir("POST", "/api/v1/ventanillas/" + ventanillaRios + "/llamar-siguiente", null, kiosco).path("ok").asBoolean()).isFalse();
        assertThat(pedir("GET", "/api/v1/movil/kiosco", null, token).path("ok").asBoolean()).isFalse();

        // Sin token no hay acceso
        assertThat(pedir("GET", "/api/v1/movil/panel", null, null).path("error").path("codigo").asString()).isEqualTo("NO_AUTENTICADO");
    }

    private JsonNode pedir(String metodo, String ruta, String cuerpo, String token) throws Exception {
        var b = HttpRequest.newBuilder(URI.create("http://localhost:" + puerto + ruta)).header("Content-Type", "application/json")
                .method(metodo, cuerpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(cuerpo));
        if (token != null) {
            b.header("Authorization", "Bearer " + token);
        }
        return json.readTree(http.send(b.build(), HttpResponse.BodyHandlers.ofString()).body());
    }

    private int ventanillaDe(int colaId) {
        return ventanillas.listar(localId).stream().filter(v -> v.colaId() != null && v.colaId() == colaId).findFirst().orElseThrow().id();
    }
}
