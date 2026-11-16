/**
 * M2 · Predicción de espera: rango "14–22 min" por cola con tres modelos (BASELINE, EMA y ESTACIONAL) evaluados sin
 * fuga de datos (walk-forward), elección automática con histéresis, monitoreo en producción y detección de deriva.
 *
 * <p>Se conecta con el núcleo implementando el puerto {@link pe.turnoya.nucleo.puertos.EstimadorEspera} (solo cuando M2
 * está activo en el local) y escuchando sus eventos (emitido, llamado, cerrado) para aprender en línea. Publica
 * {@link pe.turnoya.prediccion.DerivaDetectada} para que Analítica (M7) levante la alerta.
 *
 * <p>Slices: {@code estimacion} (puerto del núcleo, caché del modelo y aprendizaje en línea), {@code entrenamiento}
 * (reentrenamiento, deriva, métricas, configuración y página de administración) y {@code avisos} ("avisarme X min
 * antes" y "mejores horas", públicos).
 */
@ApplicationModule(displayName = "Predicción de espera (M2)")
package pe.turnoya.prediccion;

import org.springframework.modulith.ApplicationModule;
