package pe.turnoya.kiosco.operacion;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/** Páginas públicas de M5: la app del kiosco ({@code /kiosco}) y el QR del ticket provisional ({@code /k/{dispositivo}/{fecha}/{seq}}). */
@Controller
class KioscoVista {

    @GetMapping("/kiosco")
    String kiosco() {
        return "kiosco/kiosco";
    }

    @GetMapping("/k/{dispositivo}/{fecha}/{seq}")
    String provisional(@PathVariable int dispositivo, @PathVariable String fecha, @PathVariable int seq, Model modelo) {
        modelo.addAttribute("dispositivo", dispositivo);
        modelo.addAttribute("fecha", fecha.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") ? fecha : "");
        modelo.addAttribute("seq", seq);
        modelo.addAttribute("codigo", "K" + dispositivo + "-" + String.format("%04d", seq));
        return "kiosco/provisional";
    }
}
