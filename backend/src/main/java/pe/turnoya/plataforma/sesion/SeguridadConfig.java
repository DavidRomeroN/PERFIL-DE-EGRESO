package pe.turnoya.plataforma.sesion;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.session.NullAuthenticatedSessionStrategy;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;

/**
 * Reglas de seguridad de toda la aplicación.
 *
 * <ul>
 *   <li>Sin sesión de servidor: la identidad viaja en la cookie JWT (escala horizontalmente sin sesiones pegajosas).</li>
 *   <li>Rutas públicas: pantallas del cliente, TV, ticket, API pública y SSE. Todo lo demás exige sesión; los
 *       permisos finos van en cada controlador con {@code @SoloPersonal} / {@code @SoloAdmin}.</li>
 *   <li>CSRF con cookie para las páginas (htmx envía el token en una cabecera). La API JSON ({@code /api/**})
 *       queda fuera, como en legacy/: la protege la cookie SameSite=Lax.</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
class SeguridadConfig {

    private static final String[] PUBLICAS = {
            "/", "/login", "/error", "/favicon.ico", "/manifest.webmanifest",
            "/css/**", "/js/**", "/img/**", "/webjars/**",
            "/l/**", "/t/**", "/ticket/**",
            "/api/v1/public/**", "/api/v1/realtime/**", "/api/v1/auth/login", "/api/v1/auth/logout",
            "/api/health", "/actuator/health/**",
    };

    private static final String CSP = String.join("; ",
            "default-src 'self'",
            "img-src 'self' data: blob: https:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self'",
            "connect-src 'self'",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "frame-ancestors 'self'");

    @Bean
    SecurityFilterChain cadenaSeguridad(HttpSecurity http, FirmaSesion firma, Clock reloj) throws Exception {
        http
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                // El token CSRF vive en una cookie y no se rota en cada petición: la identidad es un JWT sin sesión de
                // servidor, y rotarlo invalidaría el token de la página en cuanto htmx refresca un fragmento
                .csrf(c -> c.csrfTokenRepository(new CookieCsrfTokenRepository())
                        .sessionAuthenticationStrategy(new NullAuthenticatedSessionStrategy())
                        .ignoringRequestMatchers("/api/**"))
                .authorizeHttpRequests(a -> a
                        .requestMatchers(PUBLICAS).permitAll()
                        .requestMatchers("/actuator/**").hasRole("SUPER_ADMIN")
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((peticion, respuesta, ex) -> sinSesion(peticion, respuesta))
                        .accessDeniedHandler((peticion, respuesta, ex) -> prohibido(peticion, respuesta)))
                .headers(h -> h
                        .frameOptions(f -> f.sameOrigin())
                        .contentSecurityPolicy(c -> c.policyDirectives(CSP))
                        .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                        .addHeaderWriter(new StaticHeadersWriter("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")))
                .addFilterBefore(new FiltroSesion(firma, reloj), UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(new FiltroCargarCsrf(), CsrfFilter.class);
        return http.build();
    }

    /** bcrypt: valida los hashes {@code $2b$} que generó bcryptjs en legacy/ (no hace falta resetear contraseñas). */
    @Bean
    PasswordEncoder codificadorClaves() {
        return new BCryptPasswordEncoder(10);
    }

    private static void sinSesion(HttpServletRequest peticion, HttpServletResponse respuesta) throws IOException {
        if (esApi(peticion)) {
            json(respuesta, 401, "NO_AUTENTICADO", "Inicia sesión para continuar");
            return;
        }
        String destino = peticion.getRequestURI() + (peticion.getQueryString() == null ? "" : "?" + peticion.getQueryString());
        String login = "/login?next=" + URLEncoder.encode(destino, StandardCharsets.UTF_8);
        if ("true".equals(peticion.getHeader("HX-Request"))) {
            respuesta.setHeader("HX-Redirect", login);
            respuesta.setStatus(401);
            return;
        }
        respuesta.sendRedirect(login);
    }

    private static void prohibido(HttpServletRequest peticion, HttpServletResponse respuesta) throws IOException {
        if (esApi(peticion)) {
            json(respuesta, 403, "PROHIBIDO", "No tienes permiso para esta acción");
            return;
        }
        respuesta.sendError(403);
    }

    private static boolean esApi(HttpServletRequest peticion) {
        return peticion.getRequestURI().startsWith("/api/");
    }

    private static void json(HttpServletResponse respuesta, int status, String codigo, String mensaje) throws IOException {
        respuesta.setStatus(status);
        respuesta.setContentType(MediaType.APPLICATION_JSON_VALUE);
        respuesta.setCharacterEncoding(StandardCharsets.UTF_8.name());
        respuesta.getWriter().write("{\"ok\":false,\"error\":{\"codigo\":\"" + codigo + "\",\"mensaje\":\"" + mensaje + "\"}}");
    }
}
