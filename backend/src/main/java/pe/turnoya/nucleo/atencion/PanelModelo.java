package pe.turnoya.nucleo.atencion;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import pe.turnoya.nucleo.SnapshotLocal.ColaInfo;
import pe.turnoya.nucleo.SnapshotLocal;

/**
 * Lo que muestra el panel de ventanilla, ya calculado: la plantilla solo pinta. Misma lógica que
 * {@code panel-ventanilla.tsx} del sistema anterior (cola de la ventanilla, turno en curso, tiempo de presentación RN04).
 *
 * <p>Un operador solo ve sus ventanillas ({@code ventanillas}), la espera de sus colas y emite tickets para esas colas
 * ({@code colasTicket}). Con más de una ventanilla tiene la vista "Mis ventanillas", que las muestra todas juntas.
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
        List<Puesto> puestos,
        List<SnapshotLocal.VentanillaInfo> ventanillas,
        List<ColaInfo> colasTicket,
        boolean restringido) {

    /** Valor de {@code ventanilla} que pide la vista con todas las ventanillas del operador en una pantalla. */
    public static final int TODAS = 0;

    /** {@code permitidas}: ventanillas que puede operar la sesión; {@code null} = todas (administradores). */
    public static PanelModelo de(SnapshotLocal snap, Integer ventanillaElegida, List<OpcionLocal> locales, Set<Integer> permitidas) {
        boolean restringido = permitidas != null;
        List<SnapshotLocal.VentanillaInfo> mias = snap.ventanillas().stream()
                .filter(v -> !restringido || permitidas.contains(v.id())).toList();
        List<ColaInfo> colasMias = restringido
                ? snap.colas().stream().filter(c -> mias.stream().anyMatch(v -> v.cola() != null && v.cola().id() == c.id())).toList()
                : snap.colas();
        int limite = snap.local().tiempoAusenciaSeg() == null ? 180 : snap.local().tiempoAusenciaSeg();

        if (Objects.equals(ventanillaElegida, TODAS) && mias.size() > 1) {
            List<FilaEspera> todasEnEspera = colasMias.stream()
                    .flatMap(c -> c.espera().stream().map(t -> new FilaEspera(t, c.nombre(), c.prefijo())))
                    .sorted(Comparator.comparing(f -> f.turno().emitidoAt(), Comparator.nullsLast(Comparator.naturalOrder())))
                    .toList();
            List<Puesto> puestos = mias.stream().map(v -> {
                ColaInfo cola = v.cola() == null ? null : snap.colas().stream().filter(c -> c.id() == v.cola().id()).findFirst().orElse(null);
                Actual actual = snap.colas().stream()
                        .flatMap(c -> c.llamados().stream().map(l -> new Actual(l, c.nombre(), c.id())))
                        .filter(a -> Objects.equals(a.llamado().ventanillaId(), v.id())).findFirst().orElse(null);
                return new Puesto(v, actual, cola == null ? 0 : cola.enEspera(),
                        cola == null ? List.of() : cola.espera().stream().limit(3).map(SnapshotLocal.EnEspera::codigo).toList());
            }).toList();
            return new PanelModelo(snap, null, colasMias, todasEnEspera, null, limite, locales, true, puestos, mias, colasMias, restringido);
        }
        SnapshotLocal.VentanillaInfo ventanilla = mias.stream()
                .filter(v -> Objects.equals(v.id(), ventanillaElegida)).findFirst()
                .orElse(mias.isEmpty() ? null : mias.getFirst());
        List<ColaInfo> visibles = ventanilla != null && ventanilla.cola() != null
                ? snap.colas().stream().filter(c -> c.id() == ventanilla.cola().id()).toList()
                : colasMias;
        List<FilaEspera> espera = visibles.stream()
                .flatMap(c -> c.espera().stream().map(t -> new FilaEspera(t, c.nombre(), c.prefijo())))
                .sorted(Comparator.comparingInt(f -> f.turno().posicion()))
                .toList();
        Actual actual = ventanilla == null ? null : snap.colas().stream()
                .flatMap(c -> c.llamados().stream().map(l -> new Actual(l, c.nombre(), c.id())))
                .filter(a -> Objects.equals(a.llamado().ventanillaId(), ventanilla.id()))
                .findFirst().orElse(null);
        return new PanelModelo(snap, ventanilla, visibles, espera, actual, limite, locales, false, List.of(), mias, colasMias, restringido);
    }

    /** Turno que atiende otra ventanilla (columna "Ventanillas"). */
    public SnapshotLocal.Llamado atendiendo(int ventanillaId) {
        return snap.colas().stream().flatMap(c -> c.llamados().stream())
                .filter(l -> Objects.equals(l.ventanillaId(), ventanillaId)).findFirst().orElse(null);
    }

    /** Lo que va en {@code ?ventanilla=} para volver a pedir esta misma vista. */
    public Integer idVista() {
        return todas ? Integer.valueOf(TODAS) : ventanilla == null ? null : ventanilla.id();
    }

    /** Personas en espera en las colas que ve esta sesión (para el operador, solo las suyas). */
    public int enEspera() {
        return restringido ? colasTicket.stream().mapToInt(ColaInfo::enEspera).sum() : snap.stats().enEspera();
    }

    public String descripcionCola() {
        return ventanilla != null && ventanilla.cola() != null
                ? ventanilla.cola().nombre() + " (" + ventanilla.cola().prefijo() + ")"
                : restringido ? "Tus colas" : "Todas las colas";
    }

    public record FilaEspera(SnapshotLocal.EnEspera turno, String cola, String prefijo) {
    }

    /** Una ventanilla en la vista "Mis ventanillas": su turno en curso y a quién llamaría después. */
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
