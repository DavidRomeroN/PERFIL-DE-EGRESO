package pe.turnoya.plataforma;

import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;
import pe.turnoya.plataforma.dominio.RepositorioUsuarios;

/**
 * Qué ventanillas puede operar quien inició sesión. Un operador solo ve, llama e imprime tickets en las ventanillas
 * que le asignó el administrador (una, varias o todas); los administradores no tienen restricción.
 */
@Service
public class VentanillasDelOperador {

    private final RepositorioUsuarios usuarios;

    VentanillasDelOperador(RepositorioUsuarios usuarios) {
        this.usuarios = usuarios;
    }

    /** Ventanillas asignadas; vacío (sin valor) cuando la sesión no tiene restricción (administradores). */
    public Optional<Set<Integer>> asignadas(Sesion sesion) {
        if (sesion.rol() != RolUsuario.OPERADOR) {
            return Optional.empty();
        }
        return Optional.of(new LinkedHashSet<>(usuarios.ventanillasDe(sesion.sub())));
    }
}
