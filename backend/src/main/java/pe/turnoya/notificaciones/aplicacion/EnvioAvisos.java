package pe.turnoya.notificaciones.aplicacion;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.notificaciones.NotificacionRegistrada;
import pe.turnoya.notificaciones.infraestructura.NotificacionesJdbc;
import pe.turnoya.notificaciones.infraestructura.ProveedorWhatsApp;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/**
 * Envío centralizado de avisos (D4): todo aviso queda en {@code notificacion}, respeta el plan (WhatsApp habilitado y
 * cupo mensual, RN05) y, si no corresponde WhatsApp, se degrada a aviso web. Igual que {@code enviarAviso} de legacy/.
 */
@Service
public class EnvioAvisos {

    private static final Logger log = LoggerFactory.getLogger(EnvioAvisos.class);

    private final NotificacionesJdbc notificaciones;
    private final ProveedorWhatsApp proveedor;
    private final CatalogoLocales locales;
    private final ApplicationEventPublisher eventos;
    private final MeterRegistry metricas;
    private final Clock reloj;
    /** Solo para el simulador: emula los acuses de "entregado" y "leído" que en producción llegan por webhook. */
    private final ScheduledExecutorService acusesSimulados = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory());

    EnvioAvisos(NotificacionesJdbc notificaciones, ProveedorWhatsApp proveedor, CatalogoLocales locales, ApplicationEventPublisher eventos,
                MeterRegistry metricas, Clock reloj) {
        this.notificaciones = notificaciones;
        this.proveedor = proveedor;
        this.locales = locales;
        this.eventos = eventos;
        this.metricas = metricas;
        this.reloj = reloj;
    }

    /** @return canal usado: {@code WHATSAPP} o {@code WEB} */
    public String enviar(Aviso aviso) {
        Local local = locales.exigir(aviso.localId());
        Instant ahora = reloj.instant();
        String motivoWeb = null;
        boolean porWhatsApp = aviso.telefonoE164() != null;
        if (porWhatsApp) {
            Plan plan = locales.planDe(local);
            if (!plan.whatsappHabilitado()) {
                porWhatsApp = false;
                motivoWeb = "Plan sin WhatsApp (RN05): aviso solo por web";
            } else if (aviso.cuentaCupo() && notificaciones.usadosDesde(local.id(), inicioMesLima(ahora)) >= plan.maxAvisosWhatsapp()) {
                porWhatsApp = false;
                motivoWeb = "Cupo mensual de WhatsApp agotado (" + plan.maxAvisosWhatsapp() + "): aviso solo por web";
                metricas.counter("whatsapp_sin_cupo_total").increment();
            }
        }
        String destino = aviso.telefonoE164() == null ? null : Telefonos.enmascarar(aviso.telefonoE164());
        int id = notificaciones.registrar(local.id(), aviso.turnoId(), aviso.citaId(), porWhatsApp ? "WHATSAPP" : "WEB", destino,
                aviso.texto(), aviso.plantilla(), porWhatsApp ? "PENDIENTE" : "ENTREGADO", porWhatsApp ? null : ahora, motivoWeb);

        if (!porWhatsApp) {
            anunciar(aviso, id, destino);
            return "WEB";
        }
        ProveedorWhatsApp.Resultado r = proveedor.enviar(aviso.telefonoE164(), aviso.plantilla(), aviso.parametros(), aviso.texto());
        if (r.ok()) {
            notificaciones.marcarEnviado(id, r.proveedorMsgId(), reloj.instant());
        } else {
            notificaciones.marcarFallido(id, r.error());
            log.warn("Envío de WhatsApp fallido local={} plantilla={}: {}", local.id(), aviso.plantilla(), r.error());
        }
        metricas.counter("whatsapp_envios_total", "plantilla", aviso.plantilla(), "resultado", r.ok() ? "ok" : "fallo").increment();
        anunciar(aviso, id, destino);
        if (r.ok() && "mock".equals(proveedor.nombre())) {
            simularAcuses(aviso, id, destino);
        }
        return "WHATSAPP";
    }

    private void anunciar(Aviso aviso, int notificacionId, String destino) {
        if (aviso.turnoId() != null) {
            eventos.publishEvent(new NotificacionRegistrada(aviso.localId(), aviso.turnoId(), notificacionId, aviso.texto(), destino));
        }
    }

    private void simularAcuses(Aviso aviso, int id, String destino) {
        acusesSimulados.schedule(() -> acuse(aviso, id, destino, "ENTREGADO"), 1500, TimeUnit.MILLISECONDS);
        acusesSimulados.schedule(() -> acuse(aviso, id, destino, "LEIDO"), 4000, TimeUnit.MILLISECONDS);
    }

    private void acuse(Aviso aviso, int id, String destino, String estado) {
        try {
            notificaciones.cambiarEstado(id, estado);
            anunciar(aviso, id, destino);
        } catch (RuntimeException e) {
            log.debug("Acuse simulado no aplicado: {}", e.getMessage());
        }
    }

    /** 00:00 del día 1 en Lima. */
    private static Instant inicioMesLima(Instant ahora) {
        LocalDate primero = Fechas.fechaLocal(Fechas.LIMA, ahora).withDayOfMonth(1);
        return Fechas.instanteLocal(primero, 0, 0, Fechas.LIMA);
    }

    /** {@code telefonoE164} nulo: el cliente no dejó celular y el aviso queda en la web. */
    public record Aviso(int localId, Integer turnoId, Integer citaId, String telefonoE164, String plantilla, List<String> parametros,
                        String texto, boolean cuentaCupo) {

        public static Aviso deTurno(int localId, int turnoId, String telefono, String plantilla, List<String> parametros, String texto) {
            return new Aviso(localId, turnoId, null, telefono, plantilla, parametros, texto, true);
        }
    }
}
