package pe.turnoya.nucleo.puertos;

/** M3: si el local ofrece reservar cita (para mostrar "¿Prefieres reservar un horario?"). */
public interface OfertaCitas {

    boolean localConCitas(int localId);

    boolean colaConCitas(int colaId);
}
