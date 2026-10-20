package pe.turnoya.nucleo;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.seguridad.CifradoDatos;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.nucleo.SnapshotLocal.ColaInfo;
import pe.turnoya.nucleo.SnapshotLocal.EnEspera;
import pe.turnoya.nucleo.SnapshotLocal.Llamado;
import pe.turnoya.nucleo.aplicacion.ExtensionesNucleo;
import pe.turnoya.nucleo.dominio.Cola;
import pe.turnoya.nucleo.dominio.Promedios;
import pe.turnoya.nucleo.dominio.Turno;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.nucleo.infraestructura.ClientesJdbc;
import pe.turnoya.nucleo.infraestructura.ColasJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc;
import pe.turnoya.nucleo.infraestructura.TurnosJdbc.TurnoDelDia;
import pe.turnoya.nucleo.infraestructura.VentanillasJdbc;
import pe.turnoya.nucleo.puertos.EstimadorEspera;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/** Consultas de solo lectura sobre turnos: "mi turno" (RF02) y la foto del local para la TV y el panel. */
@Service
@Transactional(readOnly = true)
public class ConsultaTurnos {

    private final TurnosJdbc turnos;
    private final ColasJdbc colas;
    private final VentanillasJdbc ventanillas;
    private final ClientesJdbc clientes;
    private final CatalogoLocales locales;
    private final ExtensionesNucleo extensiones;
    private final CifradoDatos cifrado;
    private final PropiedadesTurnoYa propiedades;
    private final Clock reloj;

    ConsultaTurnos(TurnosJdbc turnos, ColasJdbc colas, VentanillasJdbc ventanillas, ClientesJdbc clientes, CatalogoLocales locales,
                   ExtensionesNucleo extensiones, CifradoDatos cifrado, PropiedadesTurnoYa propiedades, Clock reloj) {
        this.turnos = turnos;
        this.colas = colas;
        this.ventanillas = ventanillas;
        this.clientes = clientes;
        this.locales = locales;
        this.extensiones = extensiones;
        this.cifrado = cifrado;
        this.propiedades = propiedades;
        this.reloj = reloj;
    }

    public TurnoPublico porToken(String token) {
        Turno t = turnos.porToken(token).orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        Cola cola = colas.porId(t.colaId()).orElseThrow();
        Local local = locales.exigir(t.localId());

        int posicion = 0;
        int segundos = 0;
        TurnoPublico.Prediccion prediccion = null;
        if (t.estado().enEspera()) {
            posicion = turnos.posicion(t.id());
            EstimadorEspera.Estimacion est = extensiones.estimar(t.localId(), t.colaId(), posicion);
            segundos = est.segundos();
            if (est.rango() != null) {
                var r = est.rango();
                prediccion = new TurnoPublico.Prediccion(segundos, r.loSeg(), r.hiSeg(), r.confianza(), r.modelo(), r.enFrio(),
                        Math.max(1, (int) Math.ceil(segundos / 60.0)), Math.max(1, (int) Math.ceil(r.hiSeg() / 60.0)));
            }
        }

        TurnoPublico.VentanillaResumen ventanilla = t.ventanillaId() == null ? null
                : ventanillas.porIdEnLocal(t.ventanillaId(), t.localId()).map(v -> new TurnoPublico.VentanillaResumen(v.id(), v.nombre())).orElse(null);

        TurnoPublico.Redireccion redirigido = t.estado() == EstadoTurno.TRANSFERIDO && t.sucesorId() != null
                ? turnos.sucesor(t.sucesorId()).map(s -> new TurnoPublico.Redireccion(s.token(), s.codigo(), s.cola())).orElse(null)
                : null;

        var datosCliente = t.clienteId() == null ? null : clientes.datos(t.clienteId()).orElse(null);
        String telefonoMasc = datosCliente == null ? null
                : cifrado.descifrar(datosCliente.telefonoCifrado()).map(Telefonos::enmascarar).orElse(null);

        return new TurnoPublico(
                t.id(), t.codigo(), t.codigoProvisional(), t.token(), t.estado(), t.canal(), t.numero(),
                posicion, Math.max(0, posicion - 1), segundos, prediccion, t.avisoMinAntes(), t.rellamadas(),
                t.emitidoAt(), t.avisadoAt(), t.llamadoAt(), t.finalizadoAt(), t.fecha().toString(),
                new TurnoPublico.ColaResumen(cola.id(), cola.nombre(), cola.prefijo(), cola.tiempoAtencionBase()),
                ventanilla,
                new TurnoPublico.ClienteResumen(datosCliente == null ? null : datosCliente.nombre(), telefonoMasc),
                new TurnoPublico.LocalPublico(local.id(), local.slug(), local.nombreComercial(), local.colorPrimario(), local.logoUrl(),
                        local.direccion(), local.avisarFaltando()),
                redirigido,
                turnos.llamandoAhora(t.colaId(), t.fecha()).stream()
                        .map(l -> new TurnoPublico.LlamandoAhora(l.codigo(), l.codigoProvisional(), l.ventanilla())).toList(),
                extensiones.avisos(t.id()),
                propiedades.urlPublica() + "/t/" + t.token());
    }

    /**
     * Foto del local. {@code paraPersonal} agrega nombres, categoría de prioridad (RN-M1-06: nunca en la TV) y los
     * tokens de seguimiento; la versión pública no los incluye.
     */
    public SnapshotLocal snapshot(Local local, boolean paraPersonal) {
        Plan plan = locales.planDe(local);
        Instant ahora = reloj.instant();
        LocalDate fecha = Fechas.fechaLocal(local.zonaHoraria(), ahora);
        List<Cola> todas = colas.delLocal(local.id());
        List<Cola> activas = todas.stream().filter(Cola::activa).toList();
        List<Ventanilla> vents = ventanillas.activasDelLocal(local.id());
        List<TurnoDelDia> delDia = turnos.delDia(local.id(), fecha);

        List<ColaInfo> infoColas = new ArrayList<>();
        for (Cola c : activas) {
            List<TurnoDelDia> propios = delDia.stream().filter(x -> x.turno().colaId() == c.id()).toList();
            List<TurnoDelDia> espera = propios.stream().filter(x -> x.turno().estado().enEspera()).toList();
            List<TurnoDelDia> llamados = propios.stream().filter(x -> x.turno().estado() == EstadoTurno.LLAMADO)
                    .sorted(Comparator.comparing((TurnoDelDia x) -> x.turno().llamadoAt(), Comparator.nullsFirst(Comparator.naturalOrder())).reversed())
                    .toList();
            List<EnEspera> enEspera = new ArrayList<>();
            for (int i = 0; i < espera.size(); i++) {
                TurnoDelDia x = espera.get(i);
                Turno t = x.turno();
                enEspera.add(new EnEspera(t.id(), t.codigo(), t.codigoProvisional(), paraPersonal ? t.token() : null, t.estado(), t.canal(),
                        t.emitidoAt(), i + 1, paraPersonal ? x.clienteNombre() : null,
                        paraPersonal ? x.categoriaNombre() : null, paraPersonal ? x.categoriaCodigo() : null,
                        paraPersonal ? t.prioridadVerificada() : null));
            }
            List<Llamado> enAtencion = llamados.stream().map(x -> new Llamado(x.turno().id(), x.turno().codigo(), x.turno().codigoProvisional(),
                    paraPersonal ? x.turno().token() : null, Objects.requireNonNullElse(x.ventanillaNombre(), ""), x.turno().ventanillaId(),
                    x.turno().llamadoAt(), x.turno().rellamadas(), paraPersonal ? x.clienteNombre() : null)).toList();
            double esperaProm = Promedios.minutos(propios.stream().filter(x -> x.turno().estado() == EstadoTurno.ATENDIDO)
                    .map(x -> Promedios.entre(x.turno().emitidoAt(), x.turno().llamadoAt())).toList());
            infoColas.add(new ColaInfo(c.id(), c.nombre(), c.prefijo(), c.descripcion(),
                    vents.stream().filter(v -> Objects.equals(v.colaId(), c.id())).map(v -> new SnapshotLocal.VentanillaCorta(v.id(), v.nombre())).toList(),
                    espera.size(), espera.isEmpty() ? 0 : extensiones.segundosDeEspera(local.id(), c.id(), 1), esperaProm, enEspera, enAtencion));
        }

        List<SnapshotLocal.UltimoLlamado> ultimos = delDia.stream()
                .filter(x -> x.turno().llamadoAt() != null && x.turno().estado() != EstadoTurno.CANCELADO && x.turno().estado() != EstadoTurno.TRANSFERIDO)
                .sorted(Comparator.comparing((TurnoDelDia x) -> x.turno().llamadoAt()).reversed())
                .limit(8)
                .map(x -> new SnapshotLocal.UltimoLlamado(x.turno().id(), x.turno().codigo(), x.turno().codigoProvisional(),
                        Objects.requireNonNullElse(x.ventanillaNombre(), ""), x.turno().estado(), x.turno().llamadoAt()))
                .toList();

        List<Turno> hoy = delDia.stream().map(TurnoDelDia::turno).toList();
        int total = (int) hoy.stream().filter(t -> t.estado() != EstadoTurno.TRANSFERIDO).count();
        int atendidos = contar(hoy, EstadoTurno.ATENDIDO);
        int noPresentados = contar(hoy, EstadoTurno.NO_SE_PRESENTO);
        int cancelados = contar(hoy, EstadoTurno.CANCELADO);
        int porQr = (int) hoy.stream().filter(t -> t.canal() == CanalTurno.QR).count();
        SnapshotLocal.Estadisticas stats = new SnapshotLocal.Estadisticas(
                total, atendidos, noPresentados, cancelados,
                (int) hoy.stream().filter(t -> t.estado().enEspera()).count(),
                contar(hoy, EstadoTurno.LLAMADO),
                porQr, Promedios.porcentaje(porQr, total), Promedios.porcentaje1(noPresentados + cancelados, total),
                Promedios.minutos(hoy.stream().filter(t -> t.llamadoAt() != null).map(t -> Promedios.entre(t.emitidoAt(), t.llamadoAt())).toList()),
                Promedios.minutos(hoy.stream().filter(t -> t.estado() == EstadoTurno.ATENDIDO)
                        .map(t -> Promedios.entre(t.llamadoAt(), t.finalizadoAt())).toList()));

        return new SnapshotLocal(
                new SnapshotLocal.LocalInfo(local.id(), local.slug(), local.nombreComercial(), local.direccion(), local.colorPrimario(),
                        local.logoUrl(), local.mensajeTv(), local.mensajeBienvenida(),
                        new SnapshotLocal.PlanInfo(plan.codigo(), plan.nombre(), plan.whatsappHabilitado()),
                        local.avisarFaltando(), local.tiempoAusenciaSeg()),
                fecha.toString(),
                vents.stream().map(v -> new SnapshotLocal.VentanillaInfo(v.id(), v.nombre(), todas.stream()
                        .filter(c -> Objects.equals(c.id(), v.colaId())).findFirst()
                        .map(c -> new SnapshotLocal.ColaCorta(c.id(), c.nombre(), c.prefijo())).orElse(null))).toList(),
                infoColas,
                ultimos,
                stats,
                ahora);
    }

    private static int contar(List<Turno> turnos, EstadoTurno estado) {
        return (int) turnos.stream().filter(t -> t.estado() == estado).count();
    }
}
