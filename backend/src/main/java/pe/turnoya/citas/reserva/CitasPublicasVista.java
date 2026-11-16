package pe.turnoya.citas.reserva;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import org.springframework.web.util.UriUtils;
import pe.turnoya.citas.agenda.DisponibilidadCitas;
import pe.turnoya.citas.checkin.CheckinCitas;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.web.GeneradorQr;
import pe.turnoya.plataforma.Local;

/**
 * Páginas públicas de M3 sin JavaScript: {@code /l/{slug}/citas} (servicio → día → horario → datos) y {@code /c/{token}}
 * (ver, confirmar, cancelar, reprogramar y check-in con el PIN de la pantalla). {@code /cita/{token}} redirige.
 */
@Controller
class CitasPublicasVista {

    private static final DateTimeFormatter DIA = DateTimeFormatter.ofPattern("EEE d MMM", Locale.forLanguageTag("es-PE"));

    private final DisponibilidadCitas disponibilidad;
    private final ReservaCitas reservas;
    private final CheckinCitas checkin;
    private final GeneradorQr qr;

    CitasPublicasVista(DisponibilidadCitas disponibilidad, ReservaCitas reservas, CheckinCitas checkin, GeneradorQr qr) {
        this.disponibilidad = disponibilidad;
        this.reservas = reservas;
        this.checkin = checkin;
        this.qr = qr;
    }

    public record DiaVista(String fecha, String etiqueta, boolean abierto, int libres) {
    }

    @GetMapping("/l/{slug}/citas")
    String reservar(@PathVariable String slug, @RequestParam(required = false) Integer cola, @RequestParam(required = false) String fecha,
                    @RequestParam(required = false) Integer slot, Model modelo) {
        var servicios = disponibilidad.servicios(slug);
        if (servicios.local() == null) {
            throw ErrorNegocio.noEncontrado("LOCAL_NO_ENCONTRADO", "El local no existe");
        }
        modelo.addAttribute("servicios", servicios);
        modelo.addAttribute("local", servicios.local());
        if (!servicios.disponible()) {
            return "cliente/citas";
        }
        Integer colaId = cola != null ? cola : servicios.colas().size() == 1 ? servicios.colas().getFirst().id() : null;
        var elegida = servicios.colas().stream().filter(c -> colaId != null && c.id() == colaId).findFirst().orElse(null);
        modelo.addAttribute("cola", elegida);
        if (elegida == null) {
            return "cliente/citas";
        }
        Local local = disponibilidad.localPublico(slug);
        try {
            var dias = disponibilidad.disponibilidad(local, elegida.id(), 14).stream()
                    .map(d -> new DiaVista(d.fecha().toString(), DIA.format(d.fecha()), d.abierto(), d.libres())).toList();
            modelo.addAttribute("dias", dias);
            LocalDate dia = fecha == null || !fecha.matches("\\d{4}-\\d{2}-\\d{2}") ? null : LocalDate.parse(fecha);
            if (dia != null) {
                List<DisponibilidadCitas.SlotPublico> slots = disponibilidad.slotsDelDia(local, elegida.id(), dia);
                modelo.addAttribute("fecha", dia.toString());
                modelo.addAttribute("fechaEtiqueta", DIA.format(dia));
                modelo.addAttribute("slots", slots);
                modelo.addAttribute("slot", slots.stream().filter(s -> slot != null && s.id() == slot && s.disponible()).findFirst().orElse(null));
            }
        } catch (ErrorNegocio e) {
            modelo.addAttribute("error", e.getMessage());
        }
        return "cliente/citas";
    }

    @PostMapping("/l/{slug}/citas")
    String confirmarReserva(@PathVariable String slug, @RequestParam int colaId, @RequestParam int slotId, @RequestParam String fecha,
                            @RequestParam(defaultValue = "") String nombre, @RequestParam(required = false) String telefono,
                            @RequestParam(defaultValue = "false") boolean consentimiento, RedirectAttributes flash) {
        String volver = "redirect:/l/" + UriUtils.encodePathSegment(slug, java.nio.charset.StandardCharsets.UTF_8) + "/citas?cola=" + colaId + "&fecha="
                + UriUtils.encodeQueryParam(fecha, java.nio.charset.StandardCharsets.UTF_8);
        String n = nombre.trim();
        String tel = telefono == null || telefono.isBlank() ? null : telefono.trim();
        if (n.length() < 2 || n.length() > 60) {
            flash.addFlashAttribute("error", "Escribe tu nombre (2 a 60 caracteres)");
            return volver + "&slot=" + slotId;
        }
        if (tel != null && !consentimiento) {
            flash.addFlashAttribute("error", "Para usar tu celular acepta el aviso de datos personales");
            return volver + "&slot=" + slotId;
        }
        try {
            var cita = reservas.reservarPublica(slug, new ReservaCitas.Solicitud(colaId, slotId, n, tel, consentimiento, "WEB", null));
            flash.addFlashAttribute("mensaje", "¡Cita reservada!");
            return "redirect:/c/" + cita.token();
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
            return volver;
        }
    }

    @GetMapping("/cita/{token}")
    String compatibilidad(@PathVariable String token) {
        return "redirect:/c/" + UriUtils.encodePathSegment(token, java.nio.charset.StandardCharsets.UTF_8);
    }

    @GetMapping("/c/{token}")
    String ver(@PathVariable String token, @RequestParam(required = false) String fecha, Model modelo) {
        var cita = reservas.obtener(token);
        modelo.addAttribute("cita", cita);
        modelo.addAttribute("activa", cita.estado().name().equals("RESERVADA") || cita.estado().name().equals("CONFIRMADA"));
        modelo.addAttribute("qr", qr.svg(cita.urlQr(), 180));
        if (Boolean.TRUE.equals(cita.puedeCancelar()) && fecha != null && fecha.matches("\\d{4}-\\d{2}-\\d{2}")) {
            try {
                Local local = disponibilidad.localPublico(cita.local().slug());
                modelo.addAttribute("fecha", fecha);
                modelo.addAttribute("slots", disponibilidad.slotsDelDia(local, cita.cola().id(), LocalDate.parse(fecha)));
            } catch (ErrorNegocio e) {
                modelo.addAttribute("error", e.getMessage());
            }
        }
        if (Boolean.TRUE.equals(cita.puedeCancelar())) {
            try {
                Local local = disponibilidad.localPublico(cita.local().slug());
                modelo.addAttribute("dias", disponibilidad.disponibilidad(local, cita.cola().id(), 14).stream()
                        .map(d -> new DiaVista(d.fecha().toString(), DIA.format(d.fecha()), d.abierto(), d.libres())).toList());
            } catch (ErrorNegocio ignorada) {
                // Sin horarios para reprogramar
            }
        }
        return "cliente/cita";
    }

    @PostMapping("/c/{token}/confirmar")
    String confirmar(@PathVariable String token, RedirectAttributes flash) {
        return accion(token, flash, "Cita confirmada", () -> reservas.confirmar(token));
    }

    @PostMapping("/c/{token}/cancelar")
    String cancelar(@PathVariable String token, RedirectAttributes flash) {
        return accion(token, flash, "Cita cancelada; el cupo quedó libre", () -> reservas.cancelarPorToken(token));
    }

    @PostMapping("/c/{token}/reprogramar")
    String reprogramar(@PathVariable String token, @RequestParam int slotId, RedirectAttributes flash) {
        return accion(token, flash, "Cita movida al nuevo horario", () -> reservas.reprogramarPorToken(token, slotId));
    }

    @PostMapping("/c/{token}/checkin")
    String hacerCheckin(@PathVariable String token, @RequestParam(defaultValue = "") String pin, RedirectAttributes flash) {
        if (!pin.trim().matches("\\d{4}")) {
            flash.addFlashAttribute("error", "El PIN tiene 4 dígitos");
            return "redirect:/c/" + seguro(token);
        }
        try {
            var r = checkin.checkin(token, pin.trim(), false, null);
            return "redirect:/t/" + r.turnoToken();
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
            return "redirect:/c/" + seguro(token);
        }
    }

    private String accion(String token, RedirectAttributes flash, String exito, Runnable operacion) {
        try {
            operacion.run();
            flash.addFlashAttribute("mensaje", exito);
        } catch (ErrorNegocio e) {
            flash.addFlashAttribute("error", e.getMessage());
        }
        return "redirect:/c/" + seguro(token);
    }

    private static String seguro(String token) {
        return UriUtils.encodePathSegment(token, java.nio.charset.StandardCharsets.UTF_8);
    }
}
