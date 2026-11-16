package pe.turnoya.citas;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.checkin.Inasistencias;
import pe.turnoya.citas.dominio.ReglasCitas;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.colas.GestionColas;
import pe.turnoya.plataforma.Auditoria;

/**
 * Sanción escalonada por no presentarse a una cita: 1 día la primera falta, 3 la siguiente, luego 7, 15 y 30; asistir
 * a una cita reinicia la cuenta.
 */
@SpringBootTest(properties = {
        "turnoya.jobs-habilitados=false",
        "turnoya.seguridad.jwt-secret=secreto-de-pruebas-turnoya-0123456789abcdef",
        "turnoya.seguridad.data-encryption-key=clave-de-pruebas-turnoya-0123456789abcdef",
})
@Testcontainers(disabledWithoutDocker = true)
class SancionesCitasIntegracionTest {

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
    Inasistencias inasistencias;
    @Autowired
    RepositorioCitas repositorio;
    @Autowired
    DisponibilidadCitas disponibilidad;
    @Autowired
    pe.turnoya.plataforma.ModulosLocal modulos;

    private int localId;
    private int colaId;
    private int clienteId;
    private int slotId;
    private int dia;

    @BeforeEach
    void crearLocal() {
        String slug = "citas-" + System.nanoTime();
        int planId = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                                          whatsapp_habilitado, max_avisos_whatsapp)
                        VALUES (:codigo, 'Pro', 0, 10000, 10, 10, false, 0) RETURNING id""")
                .param("codigo", "PRO-" + slug).query(Integer.class).single();
        localId = jdbc.sql("""
                        INSERT INTO local (slug, razon_social, nombre_comercial, plan_id)
                        VALUES (:slug, 'Prueba SAC', 'Dental Sonrisa', :plan) RETURNING id""")
                .param("slug", slug).param("plan", planId).query(Integer.class).single();
        colaId = colas.crear(localId, new GestionColas.DatosCola("D", "Odontología", null, null, true, 1), Auditoria.Actor.SISTEMA).id();
        clienteId = jdbc.sql("INSERT INTO cliente (nombre) VALUES ('Ana') RETURNING id").query(Integer.class).single();
        Instant ayer = Instant.now().minus(Duration.ofDays(1));
        slotId = jdbc.sql("INSERT INTO slot (cola_id, inicio, fin, capacidad) VALUES (:cola, :inicio, :fin, 10) RETURNING id")
                .param("cola", colaId).param("inicio", Sql.utc(ayer)).param("fin", Sql.utc(ayer.plus(Duration.ofMinutes(15))))
                .query(Integer.class).single();
        dia = 0;
    }

    @Test
    void elDirectorioListaTodosLosLocalesConCitasYNoLosDemas() {
        String slug = jdbc.sql("SELECT slug FROM local WHERE id = :id").param("id", localId).query(String.class).single();
        assertThat(disponibilidad.localesConCitas()).extracting(DisponibilidadCitas.LocalConCitas::slug).doesNotContain(slug);

        int planId = jdbc.sql("SELECT plan_id FROM local WHERE id = :id").param("id", localId).query(Integer.class).single();
        jdbc.sql("INSERT INTO plan_modulo (plan_id, modulo) VALUES (:p, 'M3')").param("p", planId).update();
        jdbc.sql("INSERT INTO local_modulo (local_id, modulo, habilitado) VALUES (:l, 'M3', true)").param("l", localId).update();
        modulos.invalidar(localId);
        // Con el módulo activo pero sin servicios con cita, todavía no aparece
        assertThat(disponibilidad.localesConCitas()).extracting(DisponibilidadCitas.LocalConCitas::slug).doesNotContain(slug);

        jdbc.sql("INSERT INTO config_citas (cola_id, activo) VALUES (:c, true)").param("c", colaId).update();
        assertThat(disponibilidad.localesConCitas()).filteredOn(l -> l.slug().equals(slug)).singleElement()
                .satisfies(l -> {
                    assertThat(l.nombre()).isEqualTo("Dental Sonrisa");
                    assertThat(l.servicios()).isEqualTo(1);
                });
    }

    @Test
    void laSancionCreceConCadaFaltaSeguida() {
        assertThat(ReglasCitas.diasDeSancion(0)).isZero();
        assertThat(ReglasCitas.diasDeSancion(1)).isEqualTo(1);
        assertThat(ReglasCitas.diasDeSancion(2)).isEqualTo(3);
        assertThat(ReglasCitas.diasDeSancion(3)).isEqualTo(7);
        assertThat(ReglasCitas.diasDeSancion(9)).isEqualTo(30);

        cita("NO_SHOW");
        assertThat(inasistencias.aplicarBloqueo(localId, clienteId, colaId)).isTrue();
        assertThat(sancionHasta()).isCloseTo(Instant.now().plus(Duration.ofDays(1)), within(1, ChronoUnit.MINUTES));

        cita("NO_SHOW");
        assertThat(inasistencias.aplicarBloqueo(localId, clienteId, colaId)).isTrue();
        assertThat(sancionHasta()).isCloseTo(Instant.now().plus(Duration.ofDays(3)), within(1, ChronoUnit.MINUTES));

        cita("NO_SHOW");
        inasistencias.aplicarBloqueo(localId, clienteId, colaId);
        assertThat(sancionHasta()).isCloseTo(Instant.now().plus(Duration.ofDays(7)), within(1, ChronoUnit.MINUTES));
        assertThat(repositorio.sancionesVigentes(clienteId, Instant.now()))
                .singleElement()
                .satisfies(s -> {
                    assertThat(s.localNombre()).isEqualTo("Dental Sonrisa");
                    assertThat(s.motivo()).contains("3 faltas seguidas").contains("7 días");
                });
    }

    @Test
    void asistirAUnaCitaReiniciaLaCuenta() {
        cita("NO_SHOW");
        cita("NO_SHOW");
        cita("ATENDIDA");
        cita("NO_SHOW");
        assertThat(repositorio.faltasSeguidas(localId, clienteId, Instant.now().minus(Duration.ofDays(90)))).isEqualTo(1);
        inasistencias.aplicarBloqueo(localId, clienteId, colaId);
        assertThat(sancionHasta()).isCloseTo(Instant.now().plus(Duration.ofDays(1)), within(1, ChronoUnit.MINUTES));
    }

    /** Una cita pasada del cliente, cada una un poco más reciente que la anterior. */
    private void cita(String estado) {
        dia++;
        Instant inicio = Instant.now().minus(Duration.ofDays(30 - dia));
        jdbc.sql("""
                        INSERT INTO cita (local_id, cola_id, slot_id, cliente_id, fecha, inicio, fin, token, codigo_checkin, estado)
                        VALUES (:local, :cola, :slot, :cliente, CAST(:inicio AS date), :inicio, :fin, :token, :codigo, CAST(:estado AS "EstadoCita"))""")
                .param("local", localId).param("cola", colaId).param("slot", slotId).param("cliente", clienteId)
                .param("inicio", Sql.utc(inicio)).param("fin", Sql.utc(inicio.plus(Duration.ofMinutes(15))))
                .param("token", "t" + System.nanoTime() % 1_000_000_000_000L).param("codigo", Long.toString(System.nanoTime() % 2_000_000_000L, 36))
                .param("estado", estado).update();
    }

    private Instant sancionHasta() {
        return repositorio.bloqueoVigente(localId, clienteId, Instant.now()).orElseThrow();
    }
}
