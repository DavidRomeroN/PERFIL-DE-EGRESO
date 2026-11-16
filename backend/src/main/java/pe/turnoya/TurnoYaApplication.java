package pe.turnoya;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * TurnoYa — monolito modular (Spring Modulith).
 *
 * <p>Cada paquete directo de {@code pe.turnoya} es un módulo con su API pública en el paquete raíz. Por dentro es
 * hexagonal con vertical slicing: {@code dominio} (modelo y puertos), {@code infraestructura} (adaptadores JDBC,
 * WhatsApp, Redis) y una carpeta por funcionalidad con sus casos de uso y sus controladores.
 * Los módulos se comunican por interfaces públicas o por eventos; {@code ModularidadTest} verifica las fronteras
 * entre módulos y {@code ArquitecturaHexagonalTest} las capas de cada uno.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableAsync
@EnableScheduling
public class TurnoYaApplication {

    public static void main(String[] args) {
        SpringApplication.run(TurnoYaApplication.class, args);
    }
}
