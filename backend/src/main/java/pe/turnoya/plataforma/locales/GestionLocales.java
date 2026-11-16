package pe.turnoya.plataforma.locales;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.LocalCreado;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.dominio.RepositorioLocales;
import pe.turnoya.plataforma.dominio.RepositorioLocales.AltaLocal;
import pe.turnoya.plataforma.dominio.RepositorioLocales.LocalResumen;
import pe.turnoya.plataforma.dominio.RepositorioHorarios;
import pe.turnoya.plataforma.dominio.RepositorioHorarios.HorarioDia;
import pe.turnoya.plataforma.dominio.RepositorioModulos;
import pe.turnoya.plataforma.dominio.RepositorioPlanes;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios;

/**
 * RF11 · alta y administración de locales (multi-tenant, solo super admin). Al crear un local se publica
 * {@link LocalCreado}: el núcleo crea la cola "Atención general" y la "Ventanilla 1" en la misma transacción. La baja es
 * lógica (conserva datos para facturación y auditoría).
 */
@Service
public class GestionLocales {

    private final RepositorioLocales locales;
    private final RepositorioPlanes planes;
    private final RepositorioUsuarios usuarios;
    private final RepositorioModulos repositorioModulos;
    private final RepositorioHorarios horarios;
    private final ModulosLocal modulos;
    private final PasswordEncoder claves;
    private final Auditoria auditoria;
    private final ApplicationEventPublisher eventos;
    private final Clock reloj;

    GestionLocales(RepositorioLocales locales, RepositorioPlanes planes, RepositorioUsuarios usuarios, RepositorioModulos repositorioModulos,
                   RepositorioHorarios horarios, ModulosLocal modulos, PasswordEncoder claves, Auditoria auditoria, ApplicationEventPublisher eventos, Clock reloj) {
        this.locales = locales;
        this.planes = planes;
        this.usuarios = usuarios;
        this.repositorioModulos = repositorioModulos;
        this.horarios = horarios;
        this.modulos = modulos;
        this.claves = claves;
        this.auditoria = auditoria;
        this.eventos = eventos;
        this.reloj = reloj;
    }

    /** Todos los locales con su plan, recursos y turnos del mes en curso (mes UTC, como el sistema anterior). */
    public List<LocalResumen> listar() {
        Instant inicioMes = ZonedDateTime.ofInstant(reloj.instant(), ZoneOffset.UTC).withDayOfMonth(1).truncatedTo(ChronoUnit.DAYS).toInstant();
        return locales.todosConUso(inicioMes);
    }

    @Transactional
    public Local crear(Formulario f, Auditoria.Actor actor) {
        AltaLocal alta = f.validado(planes);
        if (locales.existeSlug(alta.slug())) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un local con ese identificador (slug)");
        }
        AdminInicial admin = f.adminInicial();
        if (admin != null && usuarios.existeEmail(admin.email(), null)) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un usuario con ese correo");
        }
        auditoria.fijarActor(actor);
        int id = locales.crear(alta);
        eventos.publishEvent(new LocalCreado(id, true));
        repositorioModulos.encenderDelPlan(id);
        if (admin != null) {
            usuarios.crear(id, admin.nombre(), admin.email(), RolUsuario.ADMIN_LOCAL, true, claves.encode(admin.password()));
        }
        Map<String, Object> datos = new LinkedHashMap<>();
        datos.put("slug", alta.slug());
        datos.put("planId", alta.planId());
        if (admin != null) {
            datos.put("admin", admin.email());
        }
        auditoria.registrar(actor, id, "CREAR", "local", id, "Creó el local " + alta.nombreComercial(), datos);
        return exigir(id);
    }

    /**
     * Alta desde el registro público (plan gratuito al instante o pago aprobado): el local con su admin, la cola
     * "Atención general" (sin ventanilla), horario de lunes a sábado de 8:00 a 18:00, sin expiración de llamados y con
     * los módulos del plan encendidos. Corre dentro de la transacción de quien llama.
     */
    @Transactional
    public Local altaRegistrada(AltaLocal alta, String adminNombre, String adminEmail, String hashPassword) {
        if (locales.existeSlug(alta.slug())) {
            throw ErrorNegocio.conflicto("SLUG_OCUPADO", "Esa dirección web ya está en uso; elige otra");
        }
        if (usuarios.existeEmail(adminEmail, null)) {
            throw ErrorNegocio.conflicto("EMAIL_OCUPADO", "Ya existe una cuenta con ese correo; inicia sesión");
        }
        auditoria.fijarActor(Auditoria.Actor.SISTEMA);
        int id = locales.crear(alta);
        locales.actualizarAusencia(id, null);
        usuarios.crear(id, adminNombre, adminEmail, RolUsuario.ADMIN_LOCAL, true, hashPassword);
        for (int dia = 1; dia <= 6; dia++) {
            horarios.guardar(id, new HorarioDia(dia, "08:00", "18:00", true));
        }
        eventos.publishEvent(new LocalCreado(id, false));
        repositorioModulos.encenderDelPlan(id);
        auditoria.registrar(Auditoria.Actor.SISTEMA, id, "REGISTRO", "local", id, "Se registró el local " + alta.nombreComercial(),
                Map.of("slug", alta.slug(), "planId", alta.planId(), "admin", adminEmail));
        return exigir(id);
    }

    /** ¿Están libres la dirección web y el correo? (validación previa al cobro del registro). */
    public void exigirDisponible(String slug, String email) {
        if (locales.existeSlug(slug)) {
            throw ErrorNegocio.conflicto("SLUG_OCUPADO", "Esa dirección web ya está en uso; elige otra");
        }
        if (usuarios.existeEmail(email, null)) {
            throw ErrorNegocio.conflicto("EMAIL_OCUPADO", "Ya existe una cuenta con ese correo; inicia sesión");
        }
    }

    @Transactional
    public Local editar(int id, Formulario f, boolean activo, Auditoria.Actor actor) {
        Local actual = exigir(id);
        AltaLocal datos = f.validado(planes);
        if (!datos.slug().equals(actual.slug()) && locales.existeSlug(datos.slug())) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un local con ese identificador (slug)");
        }
        auditoria.fijarActor(actor);
        locales.editar(id, datos);
        locales.activar(id, activo);
        modulos.invalidar(id);
        auditoria.registrar(actor, id, "EDITAR", "local", id, "Editó el local " + datos.nombreComercial(),
                Map.of("slug", datos.slug(), "planId", datos.planId(), "activo", activo));
        return exigir(id);
    }

    @Transactional
    public Local desactivar(int id, Auditoria.Actor actor) {
        Local actual = exigir(id);
        auditoria.fijarActor(actor);
        locales.activar(id, false);
        auditoria.registrar(actor, id, "DESACTIVAR", "local", id, "Desactivó el local " + actual.nombreComercial(), null);
        return exigir(id);
    }

    public String ruc(int id) {
        return locales.ruc(id);
    }

    public Local exigir(int id) {
        return locales.porId(id).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Local no encontrado"));
    }

    record AdminInicial(String nombre, String email, String password) {
    }

    /** Datos del formulario o del cuerpo JSON; el administrador inicial es opcional (solo al crear). */
    public record Formulario(String slug, String nombreComercial, String razonSocial, String ruc, String rubro, String direccion,
                             String telefono, String ciudad, Integer planId, String colorPrimario,
                             String adminNombre, String adminEmail, String adminPassword) {

        AltaLocal validado(RepositorioPlanes planes) {
            String s = slug == null ? "" : slug.trim();
            if (!s.matches("^[a-z0-9-]{3,40}$")) {
                throw invalido("Identificador: de 3 a 40 caracteres, solo minúsculas, números y guiones");
            }
            String nc = recortado(nombreComercial);
            if (nc == null || nc.length() < 2 || nc.length() > 80) {
                throw invalido("Nombre comercial: entre 2 y 80 caracteres");
            }
            String rs = recortado(razonSocial);
            if (rs == null || rs.length() < 2 || rs.length() > 120) {
                throw invalido("Razón social: entre 2 y 120 caracteres");
            }
            String r = recortado(ruc);
            if (r != null && !r.matches("\\d{11}")) {
                throw invalido("RUC: 11 dígitos");
            }
            String rubroV = maximo(recortado(rubro), 40, "Rubro");
            String dir = maximo(recortado(direccion), 160, "Dirección");
            String tel = maximo(recortado(telefono), 20, "Teléfono");
            String ciu = maximo(recortado(ciudad), 60, "Ciudad");
            if (planId == null || planes.porId(planId).isEmpty()) {
                throw invalido("Elige un plan válido");
            }
            String color = colorPrimario == null || colorPrimario.isBlank() ? "#0f766e" : colorPrimario.trim();
            if (!color.matches("^#[0-9a-fA-F]{6}$")) {
                throw invalido("Color: formato #RRGGBB");
            }
            return new AltaLocal(s, nc, rs, r, rubroV == null ? "Salud" : rubroV, dir, tel, ciu == null ? "Juliaca" : ciu, planId, color, null);
        }

        AdminInicial adminInicial() {
            String e = recortado(adminEmail);
            if (e == null) {
                return null;
            }
            e = e.toLowerCase(Locale.ROOT);
            if (!e.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
                throw invalido("Correo del administrador inválido");
            }
            if (adminPassword == null || adminPassword.isEmpty()) {
                throw invalido("Indica una contraseña para el administrador");
            }
            if (adminPassword.length() < 6 || adminPassword.length() > 72) {
                throw invalido("Contraseña del administrador: entre 6 y 72 caracteres");
            }
            String n = recortado(adminNombre);
            if (n != null && (n.length() < 2 || n.length() > 80)) {
                throw invalido("Nombre del administrador: entre 2 y 80 caracteres");
            }
            return new AdminInicial(n == null ? "Administrador" : n, e, adminPassword);
        }

        private static String recortado(String v) {
            return v == null || v.isBlank() ? null : v.trim();
        }

        private static String maximo(String v, int max, String campo) {
            if (v != null && v.length() > max) {
                throw invalido(campo + ": hasta " + max + " caracteres");
            }
            return v;
        }

        private static ErrorNegocio invalido(String mensaje) {
            return new ErrorNegocio("VALIDACION", mensaje, 422);
        }
    }
}
