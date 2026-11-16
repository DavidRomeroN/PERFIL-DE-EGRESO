/**
 * M5 · Kiosco offline-first: tótem táctil emparejado con un código de un solo uso que sigue emitiendo tickets sin
 * internet (cola local con clave de idempotencia) y sincroniza sin duplicados al volver.
 *
 * <p>Emite por {@code TomaDeTurnos.porKiosco} (núcleo) y hace el check-in de citas por {@link pe.turnoya.citas.CheckinPresencial}
 * (M3). Publica {@link pe.turnoya.kiosco.KioscoSinConexion} para Analítica (M7).
 *
 * <p>Slices: {@code dispositivos} (administración y página del admin) y {@code operacion} (API del dispositivo, sincronización,
 * cola de revisión, página del kiosco y QR del ticket provisional).
 */
@ApplicationModule(displayName = "Kiosco offline (M5)")
package pe.turnoya.kiosco;

import org.springframework.modulith.ApplicationModule;
