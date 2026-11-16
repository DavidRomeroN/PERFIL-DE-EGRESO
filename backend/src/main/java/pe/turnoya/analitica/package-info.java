/**
 * M7 · Analítica y SLA: percentiles de espera y atención, mapa de calor día × hora, cumplimiento del SLA con censura a
 * la derecha y presupuesto de error, CSAT, y el motor de alertas con anti-flapping, autorresolución y escalamiento.
 *
 * <p>Escucha {@link pe.turnoya.prediccion.DerivaDetectada} (M2); el
 * kiosco sin conexión (M5) se mide leyendo los latidos. Avisa por WhatsApp al local con {@code AvisosAlCliente}.
 *
 * <p>Slices: {@code tablero} (consultas, API de analítica y SLA, página {@code /admin/analitica}) y {@code alertas}
 * (motor, reglas, API de alertas y jobs).
 */
@ApplicationModule(displayName = "Analítica y SLA (M7)")
package pe.turnoya.analitica;

import org.springframework.modulith.ApplicationModule;
