package pe.turnoya.citas.agenda;

import org.springframework.stereotype.Component;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.nucleo.puertos.OfertaCitas;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;

/** Puerto del núcleo: el local ofrece reservar cita si tiene M3 y al menos un servicio con citas activas. */
@Component
class OfertaCitasM3 implements OfertaCitas {

    private final RepositorioCitas repositorio;
    private final ModulosLocal modulos;

    OfertaCitasM3(RepositorioCitas repositorio, ModulosLocal modulos) {
        this.repositorio = repositorio;
        this.modulos = modulos;
    }

    @Override
    public boolean localConCitas(int localId) {
        return modulos.activo(localId, Modulo.M3) && repositorio.colasDelLocal(localId).stream().anyMatch(c -> c.activa() && c.conCitas());
    }

    @Override
    public boolean colaConCitas(int colaId) {
        return repositorio.configsActivas().stream().anyMatch(c -> c.colaId() == colaId && modulos.activo(c.localId(), Modulo.M3));
    }
}
