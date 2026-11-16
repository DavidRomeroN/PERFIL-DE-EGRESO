package pe.turnoya.plataforma.locales;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalDeTrabajo;
import pe.turnoya.plataforma.Sesion;
import pe.turnoya.plataforma.SoloSuperAdmin;
import pe.turnoya.plataforma.dominio.RepositorioLocales.LocalResumen;

/** {@code /api/v1/locales} (RF11, solo super admin), mismo contrato que el sistema anterior. */
@RestController
@SoloSuperAdmin
@RequestMapping("/api/v1/locales")
class LocalesApi {

    private final GestionLocales locales;

    LocalesApi(GestionLocales locales) {
        this.locales = locales;
    }

    @GetMapping
    RespuestaApi<List<LocalResumen>> listar() {
        return RespuestaApi.ok(locales.listar());
    }

    @PostMapping
    ResponseEntity<RespuestaApi<Local>> crear(@AuthenticationPrincipal Sesion sesion, @RequestBody GestionLocales.Formulario datos,
                                              HttpServletRequest peticion) {
        return RespuestaApi.creado(locales.crear(datos, Auditoria.Actor.de(sesion, peticion)));
    }

    /** Edición parcial: los campos que no vienen conservan su valor. */
    @PatchMapping("/{id}")
    RespuestaApi<Local> editar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, @RequestBody Map<String, Object> cuerpo,
                               HttpServletRequest peticion) {
        Local l = locales.exigir(id);
        var datos = new GestionLocales.Formulario(texto(cuerpo, "slug", l.slug()), texto(cuerpo, "nombreComercial", l.nombreComercial()),
                texto(cuerpo, "razonSocial", l.razonSocial()), texto(cuerpo, "ruc", locales.ruc(id)), texto(cuerpo, "rubro", l.rubro()),
                texto(cuerpo, "direccion", l.direccion()), texto(cuerpo, "telefono", l.telefono()), texto(cuerpo, "ciudad", l.ciudad()),
                cuerpo.get("planId") instanceof Number n ? n.intValue() : l.planId(), texto(cuerpo, "colorPrimario", l.colorPrimario()),
                null, null, null);
        boolean activo = cuerpo.get("activo") instanceof Boolean b ? b : l.activo();
        return RespuestaApi.ok(locales.editar(id, datos, activo, Auditoria.Actor.de(sesion, peticion)));
    }

    @DeleteMapping("/{id}")
    RespuestaApi<Local> desactivar(@AuthenticationPrincipal Sesion sesion, @PathVariable int id, HttpServletRequest peticion) {
        return RespuestaApi.ok(locales.desactivar(id, Auditoria.Actor.de(sesion, peticion)));
    }

    /** El super admin elige el local sobre el que administra (cookie {@code turnoya_local}). */
    @PostMapping("/activo")
    RespuestaApi<Map<String, Object>> activo(@RequestBody Map<String, Object> cuerpo, HttpServletResponse respuesta) {
        Object valor = cuerpo.get("localId");
        int localId = valor instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(valor));
        Local l = locales.exigir(localId);
        Cookie cookie = new Cookie(LocalDeTrabajo.COOKIE, String.valueOf(l.id()));
        cookie.setPath("/");
        cookie.setHttpOnly(true);
        cookie.setMaxAge(60 * 60 * 24 * 30);
        cookie.setAttribute("SameSite", "Lax");
        respuesta.addCookie(cookie);
        return RespuestaApi.ok(Map.of("id", l.id(), "slug", l.slug(), "nombreComercial", l.nombreComercial()));
    }

    private static String texto(Map<String, Object> cuerpo, String campo, String actual) {
        return cuerpo.containsKey(campo) ? (cuerpo.get(campo) == null ? null : String.valueOf(cuerpo.get(campo))) : actual;
    }
}
