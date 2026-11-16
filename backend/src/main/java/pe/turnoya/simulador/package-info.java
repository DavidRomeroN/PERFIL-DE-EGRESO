/**
 * M8 · Simulador de capacidad: ¿cuántas ventanillas hacen falta para que casi todos esperen menos de X minutos?
 *
 * <p>Dos motores puros en {@code dominio/}: Erlang C (M/M/c analítico, estable con la recursión de Erlang B) y una
 * simulación de eventos discretos con Monte Carlo (llegadas no homogéneas, atención log-normal o empírica, abandono y
 * no-show), reproducible por semilla y con números aleatorios comunes entre escenarios.
 *
 * <p>Slice {@code capacidad}: calibración con el histórico de una cola, validación con los últimos días (backtest),
 * escenarios guardados y la página {@code /admin/simulador}. Solo lee turnos: no publica ni escucha eventos.
 */
@ApplicationModule(displayName = "Simulador de capacidad (M8)")
package pe.turnoya.simulador;

import org.springframework.modulith.ApplicationModule;
