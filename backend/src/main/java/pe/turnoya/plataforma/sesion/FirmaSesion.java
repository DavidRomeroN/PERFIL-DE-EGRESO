package pe.turnoya.plataforma.sesion;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.Sesion;

/**
 * Firma y verifica la sesión como JWT HS256 con {@code JWT_SECRET}: mismo algoritmo, secreto y campos que
 * {@code backend/src/auth.ts} de legacy/. Una cookie emitida por un sistema la acepta el otro.
 */
@Component
public class FirmaSesion {

    public static final Duration DURACION = Duration.ofHours(12);
    /** Secreto de desarrollo de legacy/ cuando no hay JWT_SECRET (ValidadorSecretos lo impide en producción). */
    private static final String SECRETO_DESARROLLO = "turnoya-dev-secret-cambiar-en-produccion-2026";

    private final byte[] secreto;

    /** Constructor que usa Spring; el que recibe el texto de la clave es para las pruebas. */
    @Autowired
    public FirmaSesion(PropiedadesTurnoYa propiedades) {
        this(propiedades.seguridad().jwtSecret());
    }

    public FirmaSesion(String secretoConfigurado) {
        String s = secretoConfigurado == null || secretoConfigurado.isBlank() ? SECRETO_DESARROLLO : secretoConfigurado;
        this.secreto = s.getBytes(StandardCharsets.UTF_8);
        if (secreto.length < 32) {
            throw new IllegalStateException("JWT_SECRET debe tener al menos 32 caracteres (HS256)");
        }
    }

    public String firmar(Sesion sesion, Instant ahora) {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(String.valueOf(sesion.sub()))
                .claim("email", sesion.email())
                .claim("nombre", sesion.nombre())
                .claim("rol", sesion.rol().name())
                .claim("localId", sesion.localId())
                .claim("localSlug", sesion.localSlug())
                .claim("localNombre", sesion.localNombre())
                .issueTime(Date.from(ahora))
                .expirationTime(Date.from(ahora.plus(DURACION)))
                .build();
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(secreto));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("No se pudo firmar la sesión", e);
        }
    }

    /** Vacío si el token no es válido, está vencido o fue firmado con otro secreto. */
    public Optional<Sesion> verificar(String token, Instant ahora) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(secreto))) {
                return Optional.empty();
            }
            JWTClaimsSet c = jwt.getJWTClaimsSet();
            if (c.getExpirationTime() == null || !c.getExpirationTime().toInstant().isAfter(ahora)) {
                return Optional.empty();
            }
            Number localId = (Number) c.getClaim("localId");
            return Optional.of(new Sesion(
                    Integer.parseInt(c.getSubject()),
                    c.getStringClaim("email"),
                    c.getStringClaim("nombre"),
                    RolUsuario.valueOf(c.getStringClaim("rol")),
                    localId == null ? null : localId.intValue(),
                    c.getStringClaim("localSlug"),
                    c.getStringClaim("localNombre")));
        } catch (ParseException | JOSEException | RuntimeException e) {
            return Optional.empty();
        }
    }
}
