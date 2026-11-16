package pe.turnoya.nucleo.atencion;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import pe.turnoya.nucleo.SnapshotLocal.ColaInfo;
import pe.turnoya.nucleo.SnapshotLocal;

/**
 * Lo que muestra el panel de ventanilla, ya calculado: la plantilla solo pinta. Misma lógica que
 * {@code panel-ventanilla.tsx} del sistema anterior (cola de la ventanilla, turno en curso, tiempo de presentación RN04).
 */
public record PanelModelo(
        SnapshotLocal snap,
        SnapshotLocal.VentanillaInfo ventanilla,
        List<ColaInfo> colasVisibles,
        List<FilaEspera> espera,
        Actual actual,
        int limiteAusenciaSeg,
        List<OpcionLocal> locales,
        boolean todas,
        List<Puesto> puestos) {

    /** Valor de {@code ventanilla} que pide la vista "Todas las ventanillas" (una sola persona opera el local). */
    public static final int TODAS = 0;

    public static PanelModelo de(SnapshotLocal snap, Integer ventanillaElegida, List<OpcionLocal> locales) {
        int limiteTodas = snap.local().tiempoAusenciaSeg() == null ? 180 : snap.local().tiempoAusenciaSeg();
        if (Objects.equals(ventanillaElegida, TODAS) && snap.ventanillas().size() > 1) {
            List<FilaEspera> todasEnEspera = snap.colas().stream()
                    .flatMap(c -> c.espera().stream().map(t -> new FilaEspera(t, c.nombre(), c.prefijo())))
                    .sorted(Comparator.comparing(f -> f.turno().emitidoAt(), Comparator.nullsLast(Comparator.naturalOrder())))
                    .toList();
            List<Puesto> puestos = snap.ventanillas().stream().map(v -> {
                ColaInfo cola = v.cola() == null ? null : snap.colas().stream().filter(c -> c.id() == v.cola().id()).findFirst().orElse(null);
                Actual actual = snap.colas().stream()
                        .flatMap(c -> c.llamados().stream().map(l -> new Actual(l, c.nombre(), c.id())))
                        .filter(a -> Objects.equals(a.llamado().ventanillaId(), v.id())).findFirst().orElse(null);
                return new Puesto(v, actual, cola == null ? 0 : cola.enEspera(),
                        cola == null ? List.of() : cola.espera().stream().limit(3).map(SnapshotLocal.EnEspera::codigo).toList());
            }).toList();
            return new PanelModelo(snap, null, snap.colas(), todasEnEspera, null, limiteTodas, locales, true, puestos);
        }
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
        return new PanelModelo(snap, ventanilla, visibles, espera, actual, limite, locales, false, List.of());
    }

    /** Turno que atiende otra ventanilla (columna "Ventanillas del local"). */
    public SnapshotLocal.Llamado atendiendo(int ventanillaId) {
        return snap.colas().stream().flatMap(c -> c.llamados().stream())
                .filter(l -> Objects.equals(l.ventanillaId(), ventanillaId)).findFirst().orElse(null);
    }

    /** Lo que va en {@code ?ventanilla=} para volver a pedir esta misma vista. */
    public Integer idVista() {
        return todas ? Integer.valueOf(TODAS) : ventanilla == null ? null : ventanilla.id();
    }

    public String descripcionCola() {
        return ventanilla != null && ventanilla.cola() != null
                ? ventanilla.cola().nombre() + " (" + ventanilla.cola().prefijo() + ")"
                : "Todas las colas";
    }

    public record FilaEspera(SnapshotLocal.EnEspera turno, String cola, String prefijo) {
    }

    /** Una ventanilla en la vista "Todas las ventanillas": su turno en curso y a quién llamaría después. */
    public record Puesto(SnapshotLocal.VentanillaInfo ventanilla, Actual actual, int enEspera, List<String> siguientes) {

        /** Código del turno que llamaría el botón; {@code null} si su cola está vacía. */
        public String siguiente() {
            return siguientes.isEmpty() ? null : siguientes.getFirst();
        }
    }

    public record Actual(SnapshotLocal.Llamado llamado, String cola, int colaId) {
    }

    public record OpcionLocal(String slug, String nombre) {
    }
}
