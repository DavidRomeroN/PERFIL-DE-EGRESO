package pe.turnoya.notificaciones.bandeja;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.seguridad.Telefonos;
import pe.turnoya.notificaciones.dominio.GatewayOpenWa;
import pe.turnoya.notificaciones.dominio.ProveedorWhatsApp;
import pe.turnoya.notificaciones.dominio.RepositorioNotificaciones;
import pe.turnoya.notificaciones.dominio.RepositorioNotificaciones.AvisoBandeja;
import pe.turnoya.plataforma.Auditoria;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/** Bandeja de salida de avisos y conexión del número de WhatsApp (gateway OpenWA). */
@Service
class BandejaAvisos {

    private final RepositorioNotificaciones notificaciones;
    private final ProveedorWhatsApp proveedor;
    private final GatewayOpenWa openWa;
    private final CatalogoLocales locales;
    private final Auditoria auditoria;

    BandejaAvisos(RepositorioNotificaciones notificaciones, ProveedorWhatsApp proveedor, GatewayOpenWa openWa, CatalogoLocales locales,
                  Auditoria auditoria) {
        this.notificaciones = notificaciones;
        this.proveedor = proveedor;
        this.openWa = openWa;
        this.locales = locales;
        this.auditoria = auditoria;
    }

    Bandeja bandeja(int localId, int limite) {
        Local local = locales.exigir(localId);
        Plan plan = locales.planDe(local);
        return new Bandeja(notificaciones.bandeja(localId, Math.max(1, Math.min(200, limite))), notificaciones.resumenWhatsApp(localId),
                proveedor.nombre(), plan.whatsappHabilitado(), plan.maxAvisosWhatsapp());
    }

    GatewayOpenWa.Estado estadoConexion() {
        return openWa.estado();
    }

    /** Acciones del panel de conexión: iniciar, detener, desvincular o prueba (con {@code telefono}). */
    GatewayOpenWa.Estado accion(int localId, String accion, String telefono, Auditoria.Actor actor) {
        switch (accion == null ? "" : accion) {
            case "iniciar" -> {
                openWa.iniciar();
                auditoria.registrar(actor, localId, "WHATSAPP_INICIAR_SESION", "openwa", null, "Inició la sesión de WhatsApp", null);
            }
            case "detener" -> openWa.detener(false);
            case "desvincular" -> {
                openWa.detener(true);
                auditoria.registrar(actor, localId, "WHATSAPP_DESVINCULAR", "openwa", null, "Desvinculó el número de WhatsApp", null);
            }
            case "prueba" -> {
                String e164 = Telefonos.normalizar(telefono == null ? "" : telefono)
                        .orElseThrow(() -> new ErrorNegocio("TELEFONO_INVALIDO", "Ingresa un celular válido (9 dígitos, ej. 951234567)", 422));
                String local = locales.exigir(localId).nombreComercial();
                ProveedorWhatsApp.Resultado r = proveedor.enviar(e164, null, List.of(),
                        "✅ *TurnoYa* conectado correctamente.\nEste número enviará los avisos de turno de " + local + ".");
                if (!r.ok()) {
                    throw new ErrorNegocio("OPENWA", r.error(), 502);
                }
            }
            default -> throw new ErrorNegocio("VALIDACION", "Acción desconocida", 422);
        }
        return openWa.estado();
    }

    record Bandeja(List<AvisoBandeja> notificaciones, Map<String, Integer> resumen, String proveedor, boolean whatsappHabilitado, int maxAvisos) {

        private int de(String estado) {
            return resumen.getOrDefault(estado, 0);
        }

        public int total() {
            return de("ENVIADO") + de("ENTREGADO") + de("LEIDO") + de("FALLIDO") + de("PENDIENTE");
        }

        /** Porcentaje entregado o leído sobre el total de mensajes de WhatsApp. */
        public int tasaEntrega() {
            return total() == 0 ? 0 : Math.round((de("ENTREGADO") + de("LEIDO")) * 100f / total());
        }

        public int leidos() {
            return de("LEIDO");
        }

        public int fallidos() {
            return de("FALLIDO");
        }
    }
}
