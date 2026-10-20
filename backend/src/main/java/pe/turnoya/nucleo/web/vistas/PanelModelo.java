package pe.turnoya.nucleo.web.vistas;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import pe.turnoya.nucleo.SnapshotLocal;
import pe.turnoya.nucleo.SnapshotLocal.ColaInfo;

/**
 * Lo que muestra el panel de ventanilla, ya calculado: la plantilla solo pinta. Misma lógica que
 * {@code panel-ventanilla.tsx} de legacy/ (cola de la ventanilla, turno en curso, tiempo de presentación RN04).
 */
public record PanelModelo(
        SnapshotLocal snap,
        SnapshotLocal.VentanillaInfo ventanilla,
        List<ColaInfo> colasVisibles,
        List<FilaEspera> espera,
        Actual actual,
        int limiteAusenciaSeg,
        List<OpcionLocal> locales) {

    public static PanelModelo de(SnapshotLocal snap, Integer ventanillaElegida, List<OpcionLocal> locales) {
        SnapshotLocal.VentanillaInfo ventanilla = snap.ventanillas().stream()
                .filter(v -> Objects.equals(v.id(), ventanillaElegida)).findFirst()
                .orElse(snap.ventanillas().isEmpty() ? null : snap.ventanillas().getFirst());
        List<ColaInfo> visibles = ventanilla != null && ventanilla.cola() != null
                ? snap.colas().stream().filter(c -> c.id() == ventanilla.cola().id()).toList()
                : snap.colas();
        List<FilaEspera> espera = visibles.stream()
                .flatMap(c -> c.espera().stream().map(t -> new FilaEspera(t, c.nombre(), c.prefijo())))
                .sorted(Comparator.comparingInt(f -> f.turno().posicion()))
                .toList();
        Actual actual = ventanilla == null ? null : snap.colas().stream()
                .flatMap(c -> c.llamados().stream().map(l -> new Actual(l, c.nombre(), c.id())))
                .filter(a -> Objects.equals(a.llamado().ventanillaId(), ventanilla.id()))
                .findFirst().orElse(null);
        int limite = snap.local().tiempoAusenciaSeg() == null ? 180 : snap.local().tiempoAusenciaSeg();
        return new PanelModelo(snap, ventanilla, visibles, espera, actual, limite, locales);
    }

    /** Turno que atiende otra ventanilla (columna "Ventanillas del local"). */
    public SnapshotLocal.Llamado atendiendo(int ventanillaId) {
        return snap.colas().stream().flatMap(c -> c.llamados().stream())
                .filter(l -> Objects.equals(l.ventanillaId(), ventanillaId)).findFirst().orElse(null);
    }

    public String descripcionCola() {
        return ventanilla != null && ventanilla.cola() != null
                ? ventanilla.cola().nombre() + " (" + ventanilla.cola().prefijo() + ")"
                : "Todas las colas";
    }

    public record FilaEspera(SnapshotLocal.EnEspera turno, String cola, String prefijo) {
    }

    public record Actual(SnapshotLocal.Llamado llamado, String cola, int colaId) {
    }

    public record OpcionLocal(String slug, String nombre) {
    }
}
