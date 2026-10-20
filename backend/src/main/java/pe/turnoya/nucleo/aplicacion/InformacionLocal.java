package pe.turnoya.nucleo.aplicacion;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.infraestructura.ColasJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.puertos.PoliticaPrioridad.CategoriaCliente;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.HorarioAtencion;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.plataforma.Plan;

/** Lo que ve el cliente antes de tomar turno: colas con su espera, horario y opciones del local. */
@Service
public class InformacionLocal {

    private final CatalogoLocales locales;
    private final ColasJdbc colas;
    private final TurnosJdbc turnos;
    private final HorarioAtencion horario;
    private final ModulosLocal modulos;
    private final ExtensionesNucleo extensiones;
    private final Clock reloj;

    InformacionLocal(CatalogoLocales locales, ColasJdbc colas, TurnosJdbc turnos, HorarioAtencion horario, ModulosLocal modulos,
                     ExtensionesNucleo extensiones, Clock reloj) {
        this.locales = locales;
        this.colas = colas;
        this.turnos = turnos;
        this.horario = horario;
        this.modulos = modulos;
        this.extensiones = extensiones;
        this.reloj = reloj;
    }

    @Transactional(readOnly = true)
    public LocalParaCliente porSlug(String slug) {
        Local local = locales.activoPorSlug(slug);
        Plan plan = locales.planDe(local);
        LocalDate fecha = Fechas.fechaLocal(local.zonaHoraria(), reloj.instant());
        Set<Modulo> activos = modulos.activos(local.id());
        List<ColaParaCliente> infoColas = colas.activasDelLocal(local.id()).stream().map(c -> {
            int enEspera = turnos.enEspera(c.id(), fecha);
            return new ColaParaCliente(c.id(), c.prefijo(), c.nombre(), c.descripcion(), enEspera,
                    extensiones.segundosDeEspera(local.id(), c.id(), enEspera + 1), extensiones.colaConCitas(c.id()));
        }).toList();
        HorarioAtencion.EstadoHorario estado = horario.estado(local);
        return new LocalParaCliente(local.id(), local.slug(), local.nombreComercial(), local.rubro(), local.direccion(), local.colorPrimario(),
                local.logoUrl(), local.mensajeBienvenida(), local.avisarFaltando(),
                new PlanCliente(plan.codigo(), plan.nombre(), plan.whatsappHabilitado()),
                estado.abierto(), estado.mensaje(), estado.proximaApertura(),
                new ModulosCliente(activos.contains(Modulo.M1), activos.contains(Modulo.M2), activos.contains(Modulo.M3)),
                infoColas, extensiones.categoriasParaCliente(local.id()), extensiones.ofreceCitas(local.id()));
    }

    public record LocalParaCliente(int id, String slug, String nombreComercial, String rubro, String direccion, String colorPrimario,
                                   String logoUrl, String mensajeBienvenida, int avisarFaltando, PlanCliente plan, boolean abierto,
                                   String mensajeCerrado, Instant proximaApertura, ModulosCliente modulos, List<ColaParaCliente> colas,
                                   List<CategoriaCliente> categorias, boolean conCitas) {

        public ColaParaCliente cola(int colaId) {
            return colas.stream().filter(c -> c.id() == colaId).findFirst().orElse(null);
        }
    }

    public record PlanCliente(String codigo, String nombre, boolean whatsappHabilitado) {
    }

    public record ModulosCliente(boolean prioridades, boolean prediccion, boolean citas) {
    }

    public record ColaParaCliente(int id, String prefijo, String nombre, String descripcion, int enEspera, int tiempoEstimadoSeg, boolean conCita) {
    }
}
