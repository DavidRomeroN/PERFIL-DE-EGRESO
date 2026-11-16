package pe.turnoya.nucleo.colas;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import pe.turnoya.nucleo.dominio.RepositorioColas;
import pe.turnoya.nucleo.dominio.RepositorioVentanillas;
import pe.turnoya.plataforma.LocalCreado;

/**
 * Al dar de alta un local (super admin o registro público) crea su cola "A · Atención general" y, si se pide, la
 * "Ventanilla 1" asignada a ella. Escucha de forma síncrona: corre en la transacción del alta, así un fallo la deshace
 * entera. La plataforma no toca las tablas del núcleo.
 */
@Component
class ColasIniciales {

    private final RepositorioColas colas;
    private final RepositorioVentanillas ventanillas;

    ColasIniciales(RepositorioColas colas, RepositorioVentanillas ventanillas) {
        this.colas = colas;
        this.ventanillas = ventanillas;
    }

    @EventListener
    void alCrearLocal(LocalCreado evento) {
        int colaId = colas.crear(evento.localId(), "A", "Atención general", null, 300, true, 1);
        if (evento.conVentanilla()) {
            ventanillas.crear(evento.localId(), "Ventanilla 1", colaId, true);
        }
    }
}
