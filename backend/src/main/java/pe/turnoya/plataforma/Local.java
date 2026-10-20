package pe.turnoya.plataforma;

import java.time.Instant;
import java.time.ZoneId;

/** Local (tenant): un consultorio, banco o sede que usa TurnoYa. */
public record Local(
        int id,
        String slug,
        String razonSocial,
        String nombreComercial,
        String rubro,
        String direccion,
        String ciudad,
        String telefono,
        int planId,
        ZoneId zonaHoraria,
        boolean activo,
        String colorPrimario,
        String logoUrl,
        String mensajeTv,
        String mensajeBienvenida,
        int avisarFaltando,
        Integer tiempoAusenciaSeg,
        Instant planVenceAt) {
}
