package pe.turnoya.nucleo.dominio;

/** Cola de atención (Caja, Laboratorio…). El prefijo arma el código del turno: A-001, LAB-002. */
public record Cola(int id, int localId, String prefijo, String nombre, String descripcion, boolean activa, int tiempoAtencionBase, int orden) {
}
