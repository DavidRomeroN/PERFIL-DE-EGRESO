package pe.turnoya.nucleo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.aplicacion.EmisionTurnos;
import pe.turnoya.nucleo.aplicacion.HistorialTurnos;
import pe.turnoya.nucleo.aplicacion.OperacionVentanilla;
import pe.turnoya.nucleo.aplicacion.SolicitudEmision;
import pe.turnoya.plataforma.Auditoria;

/**
 * Núcleo contra un PostgreSQL real (Testcontainers): Flyway aplica las migraciones de legacy/ desde cero y se
 * prueban las garantías que más importan. Se omite si no hay Docker (en CI siempre corre).
 */
@SpringBootTest(properties = {
        "turnoya.jobs-habilitados=false",
        "turnoya.seguridad.jwt-secret=secreto-de-pruebas-turnoya-0123456789abcdef",
        "turnoya.seguridad.data-encryption-key=clave-de-pruebas-turnoya-0123456789abcdef",
})
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class NucleoIntegracionTest {

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    @DynamicPropertySource
    static void baseDeDatos(DynamicPropertyRegistry registro) {
        // Mismo formato que la DATABASE_URL de legacy/ (también prueba la conversión a JDBC)
        registro.add("turnoya.database-url", () -> "postgresql://" + POSTGRES.getUsername() + ":" + POSTGRES.getPassword() + "@"
                + POSTGRES.getHost() + ":" + POSTGRES.getMappedPort(5432) + "/" + POSTGRES.getDatabaseName() + "?schema=public");
    }

    @Autowired
    JdbcClient jdbc;
    @Autowired
    EmisionTurnos emision;
    @Autowired
    OperacionVentanilla operacion;
    @Autowired
    ConsultaTurnos consulta;
    @Autowired
    HistorialTurnos historial;
    @Autowired
    MockMvc mvc;

    private int localId;
    private int colaId;
    private final List<Integer> ventanillas = new ArrayList<>();
    private String slug;

    @BeforeEach
    void crearLocal() {
        slug = "prueba-" + System.nanoTime();
        int planId = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                                          whatsapp_habilitado, max_avisos_whatsapp)
                        VALUES (:codigo, 'Pro', 0, 10000, 10, 10, true, 1000) RETURNING id""")
                .param("codigo", "PRO-" + slug).query(Integer.class).single();
        localId = jdbc.sql("""
                        INSERT INTO local (slug, razon_social, nombre_comercial, plan_id, tiempo_ausencia_seg)
                        VALUES (:slug, 'Prueba SAC', 'Local de prueba', :plan, NULL) RETURNING id""")
                .param("slug", slug).param("plan", planId).query(Integer.class).single();
        colaId = jdbc.sql("INSERT INTO cola (local_id, prefijo, nombre) VALUES (:local, 'A', 'Caja') RETURNING id")
                .param("local", localId).query(Integer.class).single();
        ventanillas.clear();
        for (int i = 1; i <= 3; i++) {
            ventanillas.add(jdbc.sql("INSERT INTO ventanilla (local_id, nombre, cola_id) VALUES (:local, :nombre, :cola) RETURNING id")
                    .param("local", localId).param("nombre", "Ventanilla " + i).param("cola", colaId).query(Integer.class).single());
        }
    }

    @Test
    void numeraLosTurnosPorColaYDia() {
        TurnoPublico primero = emision.emitir(SolicitudEmision.porQr(colaId, "Ana", null, false, null));
        TurnoPublico segundo = emision.emitir(SolicitudEmision.porQr(colaId, null, null, false, null));
        assertThat(primero.codigo()).isEqualTo("A-001");
        assertThat(segundo.codigo()).isEqualTo("A-002");
        assertThat(consulta.porToken(segundo.token()).personasDelante()).isEqualTo(1);
    }

    @Test
    void unCelularSoloTieneUnTurnoActivoPorCola() {
        emision.emitir(SolicitudEmision.porQr(colaId, "Ana", "951 234 567", true, null));
        assertThatThrownBy(() -> emision.emitir(SolicitudEmision.porQr(colaId, "Ana", "+51951234567", true, null)))
                .isInstanceOf(ErrorNegocio.class)
                .extracting(e -> ((ErrorNegocio) e).codigo())
                .isEqualTo("TURNO_DUPLICADO");
    }

    @Test
    void sinConsentimientoNoSeGuardaElCelular() {
        assertThatThrownBy(() -> emision.emitir(SolicitudEmision.porQr(colaId, "Ana", "951234567", false, null)))
                .extracting(e -> ((ErrorNegocio) e).codigo())
                .isEqualTo("CONSENTIMIENTO_REQUERIDO");
    }

    /** C2: tres ventanillas llamando a la vez nunca toman el mismo turno. */
    @Test
    void ventanillasConcurrentesNuncaLlamanElMismoTurno() throws Exception {
        int total = 30;
        for (int i = 0; i < total; i++) {
            emision.emitir(SolicitudEmision.porQr(colaId, null, null, false, null));
        }
        Set<String> llamados = ConcurrentHashMap.newKeySet();
        List<Future<?>> tareas = new ArrayList<>();
        try (ExecutorService hilos = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int v : ventanillas) {
                tareas.add(hilos.submit(() -> {
                    Optional<TurnoPublico> t;
                    while ((t = operacion.llamarSiguiente(v, localId, Auditoria.Actor.SISTEMA)).isPresent()) {
                        assertThat(llamados.add(t.get().codigo())).as("turno repetido %s", t.get().codigo()).isTrue();
                    }
                    return null;
                }));
            }
            for (Future<?> f : tareas) {
                f.get();
            }
        }
        assertThat(llamados).hasSize(total);
        int enEspera = jdbc.sql("SELECT COUNT(*) FROM turno WHERE local_id = :l AND estado IN ('EMITIDO','AVISADO')")
                .param("l", localId).query(Integer.class).single();
        assertThat(enEspera).isZero();
    }

    /** API pública: mismo sobre {ok, data} que legacy/ y sin tokens ajenos en el estado público. */
    @Test
    void apiPublicaConElMismoContrato() throws Exception {
        mvc.perform(post("/api/v1/public/turnos").contentType(MediaType.APPLICATION_JSON).content("{\"colaId\": " + colaId + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.data.codigo").value("A-001"))
                .andExpect(jsonPath("$.data.estado").value("EMITIDO"));

        mvc.perform(get("/api/v1/public/locales/{slug}/estado", slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.colas[0].enEspera").value(1))
                .andExpect(jsonPath("$.data.colas[0].espera[0].token").doesNotExist());

        mvc.perform(post("/api/v1/public/turnos").contentType(MediaType.APPLICATION_JSON).content("{\"colaId\": 999999}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.error.codigo").value("COLA_INACTIVA"));
    }

    /** N02: historial del día con indicadores, filtrado por ventanilla. */
    @Test
    void historialDelDiaConIndicadores() {
        emision.emitir(SolicitudEmision.porQr(colaId, null, null, false, null));
        emision.emitir(SolicitudEmision.porQr(colaId, null, null, false, null));
        operacion.llamarSiguiente(ventanillas.get(0), localId, Auditoria.Actor.SISTEMA);
        operacion.llamarSiguiente(ventanillas.get(0), localId, Auditoria.Actor.SISTEMA);

        HistorialTurnos.Pagina pagina = historial.consultar(localId, null, null, null, null);
        assertThat(pagina.items()).hasSize(2);
        assertThat(pagina.kpis().total()).isEqualTo(2);
        assertThat(pagina.kpis().atendidos()).isEqualTo(1);
        assertThat(historial.consultar(localId, null, ventanillas.get(1), null, null).items()).isEmpty();
        assertThat(historial.consultar(localId, null, null, EstadoTurno.LLAMADO, null).items())
                .extracting(f -> f.codigo()).containsExactly("A-002");
    }

    @Test
    void laApiDelPersonalExigeSesion() throws Exception {
        mvc.perform(get("/api/v1/colas"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.codigo").value("NO_AUTENTICADO"));
    }

    @Test
    void lasMigracionesCreanLaTablaDeEventos() {
        assertThat(jdbc.sql("SELECT to_regclass('public.event_publication') IS NOT NULL").query(Boolean.class).single()).isTrue();
    }
}
