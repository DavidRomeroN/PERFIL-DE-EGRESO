package pe.turnoya.plataforma.usuarios;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.RolUsuario;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios.UsuarioFila;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios.VentanillaOpcion;

/**
 * Personal del local (RF10): administradores y operadores. Mismas reglas que el sistema anterior: correo único,
 * contraseña de 6 a 72 caracteres (bcrypt), nadie se desactiva ni se elimina a sí mismo.
 *
 * <p>Cada operador tiene una o varias ventanillas asignadas y solo puede llamar e imprimir tickets en ellas (por ejemplo,
 * una cuenta solo para el odontólogo). Los administradores no llevan ventanillas: pueden operar todas. El usuario de
 * kiosco tampoco: emite tickets para cualquier cola y transfiere clientes, pero no llama.
 */
@Service
public class GestionUsuarios {

    private final RepositorioUsuarios usuarios;
    private final PasswordEncoder claves;
    private final Auditoria auditoria;

    GestionUsuarios(RepositorioUsuarios usuarios, PasswordEncoder claves, Auditoria auditoria) {
        this.usuarios = usuarios;
        this.claves = claves;
        this.auditoria = auditoria;
    }

    public List<UsuarioFila> listar(int localId) {
        return usuarios.delLocal(localId);
    }

    /** Ventanillas activas del local, para elegir las de cada operador. */
    public List<VentanillaOpcion> ventanillas(int localId) {
        return usuarios.ventanillasDelLocal(localId);
    }

    /** Ventanillas asignadas a cada usuario del local (clave: id del usuario). */
    public Map<Integer, List<Integer>> asignaciones(int localId) {
        return usuarios.asignacionesDelLocal(localId);
    }

    @Transactional
    public UsuarioFila crear(int localId, DatosUsuario d, Auditoria.Actor actor) {
        DatosUsuario v = d.validado(true);
        if (usuarios.existeEmail(v.email(), null)) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un usuario con ese correo");
        }
        auditoria.fijarActor(actor);
        // Por la API, un operador sin ventanillas indicadas recibe todas (como antes de existir la asignación)
        List<Integer> asignadas = ventanillasValidas(localId, v.rol(),
                v.ventanillaIds() != null ? v.ventanillaIds() : usuarios.ventanillasDelLocal(localId).stream().map(VentanillaOpcion::id).toList());
        UsuarioFila u = usuarios.crear(localId, v.nombre(), v.email(), v.rol(), v.activo(), claves.encode(v.password()));
        usuarios.asignarVentanillas(u.id(), asignadas);
        auditoria.registrar(actor, localId, "CREAR", "usuario", u.id(), "Creó el usuario " + u.email(),
                Map.of("email", u.email(), "rol", u.rol(), "ventanillas", asignadas));
        return u;
    }

    @Transactional
    public UsuarioFila editar(int localId, int id, DatosUsuario d, int quienEdita, Auditoria.Actor actor) {
        UsuarioFila actual = exigir(localId, id);
        DatosUsuario v = d.validado(false);
        if (actual.id() == quienEdita && !v.activo()) {
            throw new ErrorNegocio("VALIDACION", "No puedes desactivar tu propia cuenta", 422);
        }
        if (usuarios.existeEmail(v.email(), id)) {
            throw ErrorNegocio.conflicto("DUPLICADO", "Ya existe un usuario con ese correo");
        }
        auditoria.fijarActor(actor);
        String hash = v.password() == null ? null : claves.encode(v.password());
        // Sin ventanillas en la petición se conservan las que tenía (la API del sistema anterior no las envía)
        List<Integer> asignadas = ventanillasValidas(localId, v.rol(),
                v.ventanillaIds() != null ? v.ventanillaIds() : usuarios.ventanillasDe(id));
        UsuarioFila u = usuarios.actualizar(id, v.nombre(), v.email(), v.rol(), v.activo(), hash);
        usuarios.asignarVentanillas(id, asignadas);
        Map<String, Object> datos = new LinkedHashMap<>();
        datos.put("nombre", v.nombre());
        datos.put("email", v.email());
        datos.put("rol", v.rol());
        datos.put("activo", v.activo());
        datos.put("ventanillas", asignadas);
        if (hash != null) {
            datos.put("password", "***");
        }
        auditoria.registrar(actor, localId, "EDITAR", "usuario", id, "Editó el usuario " + u.email(), datos);
        return u;
    }

    @Transactional
    public void eliminar(int localId, int id, int quienElimina, Auditoria.Actor actor) {
        UsuarioFila actual = exigir(localId, id);
        if (actual.id() == quienElimina) {
            throw new ErrorNegocio("VALIDACION", "No puedes eliminar tu propia cuenta", 422);
        }
        auditoria.fijarActor(actor);
        usuarios.eliminar(id);
        auditoria.registrar(actor, localId, "ELIMINAR", "usuario", id, "Eliminó el usuario " + actual.email(), Map.of("email", actual.email()));
    }

    /** Un operador necesita al menos una ventanilla activa de su local; un administrador no lleva ninguna. */
    private List<Integer> ventanillasValidas(int localId, RolUsuario rol, List<Integer> pedidas) {
        if (rol != RolUsuario.OPERADOR) {
            return List.of();
        }
        List<Integer> delLocal = usuarios.ventanillasDelLocal(localId).stream().map(VentanillaOpcion::id).toList();
        LinkedHashSet<Integer> validas = new LinkedHashSet<>();
        for (Integer id : pedidas) {
            if (id == null) {
                continue;
            }
            if (!delLocal.contains(id)) {
                throw new ErrorNegocio("VALIDACION", "Una de las ventanillas elegidas no existe o está inactiva", 422);
            }
            validas.add(id);
        }
        if (validas.isEmpty()) {
            throw new ErrorNegocio("VALIDACION", delLocal.isEmpty()
                    ? "Primero crea una cola: cada cola trae su ventanilla y el operador necesita al menos una"
                    : "Elige al menos una ventanilla para el operador", 422);
        }
        return List.copyOf(validas);
    }

    private UsuarioFila exigir(int localId, int id) {
        return usuarios.porIdEnLocal(id, localId).orElseThrow(() -> ErrorNegocio.noEncontrado("NO_ENCONTRADO", "Usuario no encontrado"));
    }

    /**
     * Datos del formulario o del cuerpo JSON. La contraseña es obligatoria solo al crear. {@code ventanillaIds}: las
     * ventanillas del operador ({@code null} = al crear, todas; al editar, sin cambios).
     */
    public record DatosUsuario(String nombre, String email, String password, RolUsuario rol, Boolean activo, List<Integer> ventanillaIds) {

        public DatosUsuario(String nombre, String email, String password, RolUsuario rol, Boolean activo) {
            this(nombre, email, password, rol, activo, null);
        }

        DatosUsuario validado(boolean creando) {
            String n = nombre == null ? "" : nombre.trim();
            if (n.length() < 2 || n.length() > 80) {
                throw new ErrorNegocio("VALIDACION", "Nombre: entre 2 y 80 caracteres", 422);
            }
            String e = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
            if (!e.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
                throw new ErrorNegocio("VALIDACION", "Correo inválido", 422);
            }
            String p = password == null || password.isEmpty() ? null : password;
            if (creando && p == null) {
                throw new ErrorNegocio("VALIDACION", "La contraseña es obligatoria al crear un usuario", 422);
            }
            if (p != null && (p.length() < 6 || p.length() > 72)) {
                throw new ErrorNegocio("VALIDACION", "Contraseña: entre 6 y 72 caracteres", 422);
            }
            if (rol != RolUsuario.ADMIN_LOCAL && rol != RolUsuario.OPERADOR && rol != RolUsuario.KIOSCO) {
                throw new ErrorNegocio("VALIDACION", "Rol: administrador del local, operador o kiosco", 422);
            }
            return new DatosUsuario(n, e, p, rol, activo == null || activo, ventanillaIds);
        }
    }
}
