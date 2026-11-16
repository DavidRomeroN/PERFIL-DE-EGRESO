package pe.turnoya.prediccion;

/**
 * RN-M2-05 · El error del modelo en producción superó 1,3 × el de validación: la cola volvió a BASELINE hasta el
 * próximo reentrenamiento. Analítica (M7) lo escucha para levantar la alerta {@code PREDICCION_DERIVA}.
 */
public record DerivaDetectada(int localId, int colaId, String modelo, double maeProduccionMin, double maeValidacionMin) {
}
