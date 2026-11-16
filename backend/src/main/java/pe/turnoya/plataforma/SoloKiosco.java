package pe.turnoya.plataforma;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.security.access.prepost.PreAuthorize;

/** Panel de kiosco: el usuario de kiosco y los administradores (que pueden verlo y usarlo igual). */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@PreAuthorize("hasAnyRole('KIOSCO', 'ADMIN_LOCAL', 'SUPER_ADMIN')")
public @interface SoloKiosco {
}
