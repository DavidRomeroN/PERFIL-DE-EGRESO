package pe.turnoya.compartido.seguridad;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.sesion.FirmaSesion;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Vectores dorados: valores producidos por el código de legacy/ ({@code legacy/backend/scripts/generar-vectores.ts}).
 * Java debe leer los datos que ya existen en la BD y aceptar las sesiones del sistema anterior (riesgo 3 del plan).
 */
class CompatibilidadLegacyTest {

    private static JsonNode vectores;

    @BeforeAll
    static void cargar() throws IOException {
        try (InputStream in = CompatibilidadLegacyTest.class.getResourceAsStream("/vectores/compatibilidad.json")) {
            vectores = JsonMapper.builder().build().readTree(in);
        }
    }

    @Test
    void normalizaHasheaYEnmascaraIgualQueNode() {
        for (JsonNode caso : vectores.get("telefonos")) {
            String entrada = caso.get("entrada").asString();
            String esperado = caso.get("e164").isNull() ? null : caso.get("e164").asString();
            String e164 = Telefonos.normalizar(entrada).orElse(null);
            assertThat(e164).as("normalizar(%s)", entrada).isEqualTo(esperado);
            if (e164 != null) {
                assertThat(Telefonos.hash(e164)).as("hash(%s)", e164).isEqualTo(caso.get("hash").asString());
                assertThat(Telefonos.enmascarar(e164)).as("enmascarar(%s)", e164).isEqualTo(caso.get("mascara").asString());
            }
        }
    }

    @Test
    void descifraLoQueCifroNode() {
        for (JsonNode caso : vectores.get("cifrado")) {
            CifradoDatos cifrado = new CifradoDatos(caso.get("clave").asString());
            assertThat(cifrado.descifrar(caso.get("cifrado").asString()))
                    .as("clave %s", caso.get("clave").asString())
                    .contains(caso.get("texto").asString());
        }
    }

    @Test
    void loQueCifraJavaLoDescifraJavaConElMismoFormato() {
        CifradoDatos cifrado = new CifradoDatos("clave-de-pruebas-turnoya-0123456789abcdef");
        String guardado = cifrado.cifrar("+51951234567");
        assertThat(guardado.split("\\.")).hasSize(3);
        assertThat(cifrado.descifrar(guardado)).contains("+51951234567");
        assertThat(new CifradoDatos("otra-clave-distinta-0123456789abcdef").descifrar(guardado)).isEmpty();
    }

    @Test
    void aceptaLasContrasenasBcryptDeNode() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
        for (JsonNode caso : vectores.get("bcrypt")) {
            assertThat(bcrypt.matches(caso.get("clave").asString(), caso.get("hash").asString())).isTrue();
            assertThat(bcrypt.matches("otra-clave", caso.get("hash").asString())).isFalse();
        }
    }

    @Test
    void aceptaLasSesionesFirmadasPorNode() {
        JsonNode jwt = vectores.get("jwt");
        FirmaSesion firma = new FirmaSesion(jwt.get("secreto").asString());
        for (JsonNode caso : jwt.get("sesiones")) {
            Instant unMinutoDespues = Instant.ofEpochMilli(caso.get("emitidoMs").asLong()).plusSeconds(60);
            Sesion sesion = firma.verificar(caso.get("token").asString(), unMinutoDespues).orElseThrow();
            JsonNode esperada = caso.get("sesion");
            assertThat(sesion.sub()).isEqualTo(esperada.get("sub").asInt());
            assertThat(sesion.email()).isEqualTo(esperada.get("email").asString());
            assertThat(sesion.rol()).isEqualTo(RolUsuario.valueOf(esperada.get("rol").asString()));
            assertThat(sesion.localId()).isEqualTo(esperada.get("localId").isNull() ? null : esperada.get("localId").asInt());
            assertThat(sesion.localSlug()).isEqualTo(esperada.get("localSlug").isNull() ? null : esperada.get("localSlug").asString());
        }
    }

    @Test
    void rechazaSesionesVencidasOFirmadasConOtroSecreto() {
        JsonNode caso = vectores.get("jwt").get("sesiones").get(0);
        String token = caso.get("token").asString();
        Instant emitido = Instant.ofEpochMilli(caso.get("emitidoMs").asLong());
        assertThat(new FirmaSesion(vectores.get("jwt").get("secreto").asString()).verificar(token, emitido.plusSeconds(13 * 3600))).isEmpty();
        assertThat(new FirmaSesion("otro-secreto-de-al-menos-32-caracteres-xx").verificar(token, emitido.plusSeconds(60))).isEmpty();
    }

    @Test
    void laSesionQueFirmaJavaLaVerificaJava() {
        FirmaSesion firma = new FirmaSesion("secreto-de-pruebas-turnoya-0123456789abcdef");
        Sesion sesion = new Sesion(3, "admin@policlinico.pe", "Admin", RolUsuario.ADMIN_LOCAL, 1, "policlinico", "Policlínico");
        Instant ahora = Instant.parse("2026-10-20T15:00:00Z");
        assertThat(firma.verificar(firma.firmar(sesion, ahora), ahora.plusSeconds(60))).contains(sesion);
    }
}
