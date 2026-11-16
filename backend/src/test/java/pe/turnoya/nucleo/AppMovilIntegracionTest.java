package pe.turnoya.nucleo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.nucleo.appmovil.CuentasApp;
import pe.turnoya.nucleo.appmovil.PresenciaApp;
import pe.turnoya.nucleo.appmovil.TurnosApp;
import pe.turnoya.nucleo.puertos.CodigosPorWhatsApp;

/**
 * App móvil contra un PostgreSQL real: prueba de presencia del QR, un turno activo por dispositivo y la cuenta con
 * el celular verificado. Se omite si no hay Docker.
 */
@SpringBootTest(properties = {
        "turnoya.jobs-habilitados=false",
        "turnoya.seguridad.jwt-secret=secreto-de-pruebas-turnoya-0123456789abcdef",
        "turnoya.seguridad.data-encryption-key=clave-de-pruebas-turnoya-0123456789abcdef",
})
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class AppMovilIntegracionTest {

    /** Códigos "enviados" por WhatsApp, por celular: el doble del puerto los deja aquí. */
    private static final Map<String, String> CODIGOS = new ConcurrentHashMap<>();

    @TestConfiguration
    static class Dobles {

        @Bean
        @Primary
        CodigosPorWhatsApp codigosDePrueba() {
            return (localId, telefono, codigo) -> {
                CODIGOS.put(telefono, codigo);
                return true;
            };
        }
    }

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
    TurnosApp turnos;
    @Autowired
    CuentasApp cuentas;
    @Autowired
    PresenciaApp presencia;
    @Autowired
    MockMvc mvc;

    /** Un teléfono distinto por prueba: la base es compartida y las reglas cuentan los turnos de cada teléfono. */
    private String dispositivo;
    private String otroDispositivo;
    private int localId;
    private int otroLocalId;
    private int colaId;
    private String slug;

    @BeforeEach
    void crearLocal() {
        slug = "app-" + System.nanoTime();
        dispositivo = "disp-" + System.nanoTime();
        otroDispositivo = "otro-" + System.nanoTime();
        int planId = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                                          whatsapp_habilitado, max_avisos_whatsapp)
                        VALUES (:codigo, 'Pro', 0, 10000, 10, 10, true, 1000) RETURNING id""")
                .param("codigo", "PRO-" + slug).query(Integer.class).single();
        localId = crearLocal(slug, planId);
        otroLocalId = crearLocal(slug + "-b", planId);
        colaId = jdbc.sql("INSERT INTO cola (local_id, prefijo, nombre) VALUES (:local, 'A', 'Caja') RETURNING id")
                .param("local", localId).query(Integer.class).single();
        jdbc.sql("DELETE FROM rate_limit").update();
    }

    private int crearLocal(String s, int planId) {
        return jdbc.sql("""
                        INSERT INTO local (slug, razon_social, nombre_comercial, plan_id, tiempo_ausencia_seg)
                        VALUES (:slug, 'Prueba SAC', 'Local de prueba', :plan, NULL) RETURNING id""")
                .param("slug", s).param("plan", planId).query(Integer.class).single();
    }

    private TurnosApp.Pedido pedido(String marca, String dispositivo, String autorizacion) {
        return new TurnosApp.Pedido(colaId, "Ana", null, marca, dispositivo, autorizacion);
    }

    private static String codigoDe(Throwable e) {
        return ((ErrorNegocio) e).codigo();
    }

    @Test
    void sinLaMarcaDelQrNoSeTomaTurno() throws Exception {
        mvc.perform(post("/api/v1/public/app/turnos").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"colaId\":" + colaId + ",\"dispositivo\":\"" + dispositivo + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.codigo").value("APP_QR_VENCIDO"));
        assertThatThrownBy(() -> turnos.tomar(pedido("zzzz.firma-inventada-0000000", dispositivo, null)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_QR_VENCIDO");
    }

    @Test
    void laMarcaDeOtroLocalNoSirve() {
        assertThatThrownBy(() -> turnos.tomar(pedido(presencia.vigente(otroLocalId), dispositivo, null)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_QR_VENCIDO");
    }

    @Test
    void conLaMarcaVigenteTomaTurnoPorHttp() throws Exception {
        mvc.perform(post("/api/v1/public/app/turnos").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"colaId\":" + colaId + ",\"nombre\":\"Ana\",\"presencia\":\"" + presencia.vigente(localId)
                                + "\",\"dispositivo\":\"" + dispositivo + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.codigo").value("A-001"))
                .andExpect(jsonPath("$.data.canal").value("APP"));
    }

    @Test
    void unDispositivoSoloTieneUnTurnoActivoPorCola() {
        String marca = presencia.vigente(localId);
        TurnoPublico primero = turnos.tomar(pedido(marca, dispositivo, null));
        assertThatThrownBy(() -> turnos.tomar(pedido(marca, dispositivo, null)))
                .isInstanceOf(ErrorNegocio.class)
                .satisfies(e -> {
                    assertThat(codigoDe(e)).isEqualTo("TURNO_DUPLICADO");
                    assertThat(((ErrorNegocio) e).extra()).containsEntry("token", primero.token());
                });
        // Otro teléfono sí puede
        assertThat(turnos.tomar(pedido(marca, otroDispositivo, null)).codigo()).isEqualTo("A-002");
    }

    @Test
    void quienFaltaTresVecesQuedaBloqueadoParaTomarTurno() {
        String marca = presencia.vigente(localId);
        for (int i = 0; i < 3; i++) {
            TurnoPublico t = turnos.tomar(pedido(marca, dispositivo, null));
            jdbc.sql("UPDATE turno SET estado = 'NO_SE_PRESENTO' WHERE token = :t").param("t", t.token()).update();
        }
        assertThatThrownBy(() -> turnos.tomar(pedido(marca, dispositivo, null)))
                .isInstanceOf(ErrorNegocio.class)
                .satisfies(e -> {
                    assertThat(codigoDe(e)).isEqualTo("APP_BLOQUEADO_FALTAS");
                    assertThat(((ErrorNegocio) e).extra()).containsKey("hasta");
                });
        // Las faltas son del teléfono: otro teléfono sin faltas sí puede
        assertThat(turnos.tomar(pedido(marca, otroDispositivo, null)).token()).isNotBlank();
    }

    @Test
    void soloUnTurnoActivoALaVez() {
        String marca = presencia.vigente(localId);
        int[] colas = new int[2];
        for (int i = 0; i < 2; i++) {
            colas[i] = jdbc.sql("INSERT INTO cola (local_id, prefijo, nombre) VALUES (:local, :p, 'Extra') RETURNING id")
                    .param("local", localId).param("p", String.valueOf((char) ('B' + i))).query(Integer.class).single();
        }
        turnos.tomar(new TurnosApp.Pedido(colas[0], "Ana", null, marca, dispositivo, null));
        assertThatThrownBy(() -> turnos.tomar(new TurnosApp.Pedido(colas[1], "Ana", null, marca, dispositivo, null)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_MAX_TURNOS");
    }

    @Test
    void sinIdentificadorDeDispositivoNoSeTomaTurno() {
        assertThatThrownBy(() -> turnos.tomar(pedido(presencia.vigente(localId), null, null)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_DISPOSITIVO_INVALIDO");
    }

    @Test
    void laPuertaDeLaWebYaNoAceptaElCanalApp() throws Exception {
        mvc.perform(post("/api/v1/public/turnos").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"colaId\":" + colaId + ",\"canal\":\"APP\"}"))
                .andExpect(status().isUpgradeRequired())
                .andExpect(jsonPath("$.error.codigo").value("APP_ACTUALIZAR"));
    }

    @Test
    void cuentaConCorreoYContrasena() throws Exception {
        String correo = "ana." + System.nanoTime() + "@gmail.com";
        // Contraseña débil y correo inválido se rechazan
        assertThatThrownBy(() -> cuentas.registrar(correo, "corta1", "Ana", true, dispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("CLAVE_DEBIL");
        assertThatThrownBy(() -> cuentas.registrar("sin-arroba", "segura123", "Ana", true, dispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("CORREO_INVALIDO");

        mvc.perform(post("/api/v1/public/app/registro").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"correo\":\"" + correo + "\",\"clave\":\"segura123\",\"nombre\":\"Ana Quispe\",\"consentimiento\":true,"
                                + "\"dispositivo\":\"" + dispositivo + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.correo").value(correo))
                .andExpect(jsonPath("$.data.nombre").value("Ana Quispe"));
        // La contraseña no se guarda en claro
        assertThat(jdbc.sql("SELECT clave_hash FROM cuenta_app WHERE correo = :c").param("c", correo).query(String.class).single())
                .doesNotContain("segura123");
        // El mismo correo (con otras mayúsculas) no crea otra cuenta
        assertThatThrownBy(() -> cuentas.registrar(correo.toUpperCase(), "segura123", "Otra", true, otroDispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("CUENTA_EXISTENTE");

        CuentasApp.SesionAbierta sesion = cuentas.ingresar(correo, "segura123", dispositivo);
        String bearer = "Bearer " + sesion.token();
        assertThat(sesion.nombre()).isEqualTo("Ana Quispe");

        // Turnos a su nombre; una falta aparece en el perfil
        TurnoPublico t = turnos.tomar(pedido(presencia.vigente(localId), dispositivo, bearer));
        jdbc.sql("UPDATE turno SET estado = 'NO_SE_PRESENTO' WHERE token = :t").param("t", t.token()).update();
        mvc.perform(get("/api/v1/public/app/perfil").header("Authorization", bearer).header("X-Dispositivo", dispositivo))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.correo").value(correo))
                .andExpect(jsonPath("$.data.conducta.faltas.length()").value(1))
                .andExpect(jsonPath("$.data.conducta.faltas[0].codigo").value(t.codigo()))
                .andExpect(jsonPath("$.data.conducta.maxFaltas").value(3))
                .andExpect(jsonPath("$.data.conducta.bloqueadoHasta").doesNotExist());
        mvc.perform(get("/api/v1/public/app/perfil")).andExpect(status().isUnauthorized());
    }

    @Test
    void cincoContrasenasMalasBloqueanLaCuenta() {
        String correo = "luis." + System.nanoTime() + "@gmail.com";
        cuentas.registrar(correo, "segura123", "Luis", true, dispositivo);
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> cuentas.ingresar(correo, "mala-clave-1", dispositivo))
                    .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("CREDENCIALES_INVALIDAS");
        }
        // Bloqueada aunque ahora la contraseña sea correcta
        assertThatThrownBy(() -> cuentas.ingresar(correo, "segura123", dispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_CUENTA_BLOQUEADA");
        // Un correo que no existe da el mismo error que una contraseña mala
        assertThatThrownBy(() -> cuentas.ingresar("nadie." + System.nanoTime() + "@gmail.com", "segura123", dispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("CREDENCIALES_INVALIDAS");
    }

    @Test
    void cuentaConCelularVerificado() throws Exception {
        String telefono = "+51951234567";
        mvc.perform(post("/api/v1/public/app/codigo").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"" + slug + "\",\"telefono\":\"951 234 567\"}"))
                .andExpect(status().isOk());
        String codigo = CODIGOS.get(telefono);
        assertThat(codigo).matches("\\d{6}");
        // Ni el código ni el celular quedan en claro
        assertThat(jdbc.sql("SELECT codigo_hash || telefono_hash FROM app_codigo").query(String.class).single())
                .doesNotContain(codigo).doesNotContain("951234567");
        // Pedir otro enseguida no se permite
        assertThatThrownBy(() -> cuentas.pedirCodigo(slug, telefono)).extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_CODIGO_RECIENTE");

        String equivocado = codigo.equals("000000") ? "000001" : "000000";
        mvc.perform(post("/api/v1/public/app/sesion").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"telefono\":\"951234567\",\"codigo\":\"" + equivocado + "\",\"consentimiento\":true}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.codigo").value("APP_CODIGO_INCORRECTO"));
        assertThat(jdbc.sql("SELECT intentos FROM app_codigo").query(Integer.class).single()).isEqualTo(1);

        CuentasApp.SesionAbierta sesion = cuentas.verificar(telefono, codigo, "Ana Quispe", true, dispositivo);
        assertThat(sesion.token()).hasSize(40);
        assertThat(sesion.telefono()).doesNotContain("951234567");
        assertThat(jdbc.sql("SELECT token_hash FROM app_sesion").query(String.class).single()).isNotEqualTo(sesion.token());
        // El código es de un solo uso
        assertThatThrownBy(() -> cuentas.verificar(telefono, codigo, null, true, dispositivo))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_CODIGO_VENCIDO");

        String bearer = "Bearer " + sesion.token();
        TurnoPublico turno = turnos.tomar(pedido(presencia.vigente(localId), dispositivo, bearer));
        // El turno queda a nombre del cliente: desde otro teléfono con la misma cuenta no puede tomar otro (uno por cuenta)
        assertThatThrownBy(() -> turnos.tomar(pedido(presencia.vigente(localId), otroDispositivo, bearer)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_MAX_TURNOS");

        mvc.perform(get("/api/v1/public/app/turnos").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].codigo").value(turno.codigo()))
                .andExpect(jsonPath("$.data[0].token").value(turno.token()))
                .andExpect(jsonPath("$.data[0].cola").value("Caja"));
        mvc.perform(get("/api/v1/public/app/turnos")).andExpect(status().isUnauthorized());

        mvc.perform(delete("/api/v1/public/app/sesion").header("Authorization", bearer)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/public/app/turnos").header("Authorization", bearer))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.codigo").value("APP_SESION_INVALIDA"));
        // Con una sesión cerrada tampoco se toma turno
        assertThatThrownBy(() -> turnos.tomar(pedido(presencia.vigente(localId), "tercer-dispositivo-prueba-3", bearer)))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_SESION_INVALIDA");
    }

    @Test
    void cincoIntentosFallidosAnulanElCodigo() {
        String telefono = "+51987654321";
        cuentas.pedirCodigo(slug, telefono);
        String codigo = CODIGOS.get(telefono);
        String equivocado = codigo.equals("111111") ? "222222" : "111111";
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> cuentas.verificar(telefono, equivocado, null, true, null))
                    .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_CODIGO_INCORRECTO");
        }
        // Ni siquiera el código correcto sirve ya
        assertThatThrownBy(() -> cuentas.verificar(telefono, codigo, null, true, null))
                .extracting(AppMovilIntegracionTest::codigoDe).isEqualTo("APP_CODIGO_BLOQUEADO");
    }
}
