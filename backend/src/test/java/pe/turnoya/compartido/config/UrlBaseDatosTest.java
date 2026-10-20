package pe.turnoya.compartido.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** La DATABASE_URL de legacy/ (formato Prisma) sirve tal cual para el proyecto Java. */
class UrlBaseDatosTest {

    @Test
    void convierteLaUrlDePrismaAJdbc() {
        var url = UrlBaseDatos.desde("postgresql://turnoya:turnoya@localhost:5432/turnoya?schema=public");
        assertThat(url.jdbcUrl()).isEqualTo("jdbc:postgresql://localhost:5432/turnoya?currentSchema=public");
        assertThat(url.usuario()).isEqualTo("turnoya");
        assertThat(url.clave()).isEqualTo("turnoya");
    }

    @Test
    void decodificaClavesConCaracteresEspeciales() {
        var url = UrlBaseDatos.desde("postgres://user:p%40ss%3Aw0rd@db.example.com/app?sslmode=require");
        assertThat(url.jdbcUrl()).isEqualTo("jdbc:postgresql://db.example.com:5432/app?sslmode=require");
        assertThat(url.clave()).isEqualTo("p@ss:w0rd");
    }

    @Test
    void conPoolerDesactivaSentenciasPreparadas() {
        var url = UrlBaseDatos.desde("postgresql://u:p@ep-algo-pooler.neon.tech/db?sslmode=require&pgbouncer=true");
        assertThat(url.jdbcUrl()).isEqualTo("jdbc:postgresql://ep-algo-pooler.neon.tech:5432/db?sslmode=require&prepareThreshold=0");
    }

    @Test
    void aceptaUnaUrlJdbcSinCambios() {
        assertThat(UrlBaseDatos.desde("jdbc:postgresql://h/db").jdbcUrl()).isEqualTo("jdbc:postgresql://h/db");
    }

    @Test
    void sinUrlExplicaQueFalta() {
        assertThatThrownBy(() -> UrlBaseDatos.desde(" ")).hasMessageContaining("DATABASE_URL");
    }
}
