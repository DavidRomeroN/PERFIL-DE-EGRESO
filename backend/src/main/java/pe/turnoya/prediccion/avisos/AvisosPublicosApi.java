package pe.turnoya.prediccion.avisos;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.tareas.TareaProgramada;
import pe.turnoya.compartido.web.IpCliente;
import pe.turnoya.compartido.web.LimitadorPeticiones;
import pe.turnoya.compartido.web.RespuestaApi;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;

/**
 * {@code PATCH /api/v1/public/turnos/{token}/aviso} ("avisarme X min antes", RF-M2-07) y
 * {@code GET /api/v1/public/colas/{id}/mejores-horas} (RF-M2-06). Públicos, con límite por IP.
 */
@RestController
class AvisosPublicosApi {

    private final AvisosPorMinutos avisos;
    private final RepositorioPrediccion repositorio;
    private final ModulosLocal modulos;
    private final LimitadorPeticiones limitador;

    AvisosPublicosApi(AvisosPorMinutos avisos, RepositorioPrediccion repositorio, ModulosLocal modulos, LimitadorPeticiones limitador) {
        this.avisos = avisos;
        this.repositorio = repositorio;
        this.modulos = modulos;
        this.limitador = limitador;
    }

    @PatchMapping("/api/v1/public/turnos/{token}/aviso")
    RespuestaApi<Map<String, Integer>> aviso(@PathVariable String token, @RequestBody Aviso b, HttpServletRequest peticion) {
        limitar("aviso", 10, peticion);
        return RespuestaApi.ok(avisos.configurar(token, b == null ? null : b.minAntes()));
    }

    @GetMapping("/api/v1/public/colas/{id}/mejores-horas")
    RespuestaApi<List<AvisosPorMinutos.FranjaEspera>> mejoresHoras(@PathVariable int id, HttpServletRequest peticion) {
        limitar("mejores-horas", 30, peticion);
        var cola = repositorio.cola(id).filter(RepositorioPrediccion.ColaInfo::activa)
                .orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        if (!modulos.activo(cola.localId(), Modulo.M2)) {
            return RespuestaApi.ok(List.of());
        }
        return RespuestaApi.ok(avisos.mejoresHoras(id));
    }

    private void limitar(String clave, int maximo, HttpServletRequest peticion) {
        if (!limitador.permitir(clave, IpCliente.de(peticion), maximo)) {
            throw new ErrorNegocio("RATE_LIMIT", "Demasiadas solicitudes.", 429);
        }
    }

    record Aviso(Integer minAntes) {
    }

    @Configuration(proxyBeanMethods = false)
    static class Tarea {

        @Bean
        TareaProgramada prediccionAvisos(AvisosPorMinutos avisos) {
            return TareaProgramada.cada("prediccion-avisos", Duration.ofSeconds(60), "M2: aviso \"X min antes\" (opt-in del cliente)", avisos::jobAvisos);
        }
    }
}
