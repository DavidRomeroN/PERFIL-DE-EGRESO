package pe.turnoya;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * TurnoYa — monolito modular (Spring Modulith).
 *
 * <p>Cada paquete directo de {@code pe.turnoya} es un módulo con su API pública en el paquete raíz y sus
 * detalles en subpaquetes ({@code dominio}, {@code aplicacion}, {@code infraestructura}, {@code web}).
 * Los módulos se comunican por interfaces públicas o por eventos; {@code ModularidadTest} verifica que no
 * haya dependencias prohibidas ni ciclos.
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
