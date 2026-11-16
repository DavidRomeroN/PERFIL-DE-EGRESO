/// Puertos de salida: lo que el dominio necesita del exterior. La infraestructura los implementa.
library;

import 'modelos.dart';

/// Servidor de TurnoYa (API pública `/api/v1/public` y canal en vivo).
abstract interface class ServicioTurnos {
  Future<Local> obtenerLocal(String slug);

  /// Toma un turno con canal APP (entra en la misma cola que WhatsApp y la web). El servidor exige la marca de
  /// [presencia] del QR y el identificador del [dispositivo]; con [sesion] el turno queda a nombre del cliente.
  Future<Turno> tomarTurno(
      {required int colaId, String? nombre, String? categoria, String? presencia, required String dispositivo, String? sesion});

  /// Mejores horas de hoy para ir a la cola (vacío si el local no tiene predicción o aún no hay historia).
  Future<List<FranjaEspera>> mejoresHoras(int colaId);

  Future<Turno> consultarTurno(String token);

  Future<Turno> cancelarTurno(String token);

  /// Emite algo cada vez que cambia el local (turno llamado, cola actualizada…).
  Stream<void> cambiosDelLocal(String slug);

  /// Pide el código de verificación: llega por el WhatsApp del local [slug].
  Future<void> pedirCodigo({required String slug, required String telefono});

  /// Verifica el código y abre la sesión del cliente.
  Future<Sesion> abrirSesion({required String telefono, required String codigo, String? nombre, required String dispositivo});

  /// Crea la cuenta con correo y contraseña y abre la sesión.
  Future<Sesion> registrar({required String correo, required String clave, required String nombre, required String dispositivo});

  /// Ingresa con correo y contraseña.
  Future<Sesion> ingresar({required String correo, required String clave, required String dispositivo});

  /// Datos de la cuenta y su estado antifraude (las faltas del [dispositivo] también cuentan).
  Future<Perfil> perfil(String sesion, String dispositivo);

  Future<void> cerrarSesion(String sesion);

  /// Últimos turnos del cliente en todos los locales.
  Future<List<TurnoPasado>> historial(String sesion);
}

/// Dónde se recuerda el turno activo entre aperturas de la app.
abstract interface class AlmacenTurno {
  Future<String?> leer();

  Future<void> guardar(String token);

  Future<void> borrar();
}

/// Dónde viven la identidad del teléfono y la sesión del cliente (almacén cifrado del sistema).
abstract interface class AlmacenCuenta {
  /// Identificador de esta instalación: se genera la primera vez y no cambia.
  Future<String> dispositivo();

  Future<Sesion?> leerSesion();

  Future<void> guardarSesion(Sesion sesion);

  Future<void> borrarSesion();
}

/// Locales visitados y favoritos (no es información sensible: son nombres de locales públicos).
abstract interface class AlmacenLocales {
  Future<List<LocalGuardado>> leer();

  Future<void> guardar(List<LocalGuardado> locales);
}

/// Avisos del teléfono (notificación local, sin Firebase).
abstract interface class Notificador {
  Future<void> preparar();

  Future<void> avisar(String titulo, String cuerpo);
}
