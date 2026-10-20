package pe.turnoya.compartido.config;

import com.zaxxer.hikari.HikariDataSource;
import java.time.Clock;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Conexión a PostgreSQL a partir de {@code DATABASE_URL}.
 *
 * <p>Las columnas de fecha creadas por Prisma son {@code TIMESTAMP(3)} sin zona y guardan UTC. Cada conexión fija
 * {@code TIME ZONE 'UTC'} para que {@code now()} y las funciones SQL ({@code emitir_turno}) escriban en UTC aunque
 * el servidor de la aplicación esté en hora de Lima.
 */
@Configuration(proxyBeanMethods = false)
class BaseDatosConfig {

    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    HikariDataSource dataSource(PropiedadesTurnoYa propiedades) {
        UrlBaseDatos url = UrlBaseDatos.desde(propiedades.databaseUrl());
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(url.jdbcUrl());
        if (url.usuario() != null) {
            ds.setUsername(url.usuario());
        }
        if (url.clave() != null) {
            ds.setPassword(url.clave());
        }
        ds.setConnectionInitSql("SET TIME ZONE 'UTC'");
        ds.setPoolName("turnoya");
        return ds;
    }

    /** Reloj inyectable: las reglas que dependen de la hora se prueban con un reloj fijo. */
    @Bean
    Clock reloj() {
        return Clock.systemUTC();
    }
}
