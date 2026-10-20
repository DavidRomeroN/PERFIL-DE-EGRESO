package pe.turnoya.plataforma;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.security.access.prepost.PreAuthorize;

/** Operadores de ventanilla y administradores (el "personal" del local). */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@PreAuthorize("hasAnyRole('OPERADOR', 'ADMIN_LOCAL', 'SUPER_ADMIN')")
public @interface SoloPersonal {
}
