package pe.turnoya.citas;

import org.springframework.stereotype.Service;
import pe.turnoya.citas.checkin.CheckinCitas;

/** Interfaz pública de M3 para el kiosco (M5): check-in por el código corto de la cita (estar frente al kiosco prueba presencia). */
@Service
public class CheckinPresencial {

    private final CheckinCitas checkin;

    CheckinPresencial(CheckinCitas checkin) {
        this.checkin = checkin;
    }

    public record Resultado(String turnoToken, String codigo, boolean tarde, boolean repetido) {
    }

    /** Lanza {@code ErrorNegocio} si la cita no existe, está fuera de la ventana o el local no tiene M3. */
    public Resultado porCodigo(int localId, String codigo) {
        var r = checkin.checkinPorCodigo(localId, codigo);
        return new Resultado(r.turnoToken(), r.codigo(), r.tarde(), r.repetido());
    }
}
