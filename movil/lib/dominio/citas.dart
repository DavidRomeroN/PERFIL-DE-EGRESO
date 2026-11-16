/// Citas con hora: el cliente reserva desde la app, hace check-in al llegar (escaneando el QR «App» de la TV) y, si
/// no se presenta, el local lo sanciona sin poder reservar por 1 día, luego 3, 7, 15 y hasta 30.
library;

/// Servicio (cola) del local que acepta citas.
class ServicioCita {
  const ServicioCita({required this.id, required this.nombre, this.descripcion, required this.duracionMin, required this.diasMax});

  final int id;
  final String nombre;
  final String? descripcion;
  final int duracionMin;
  final int diasMax;
}

/// Lo que el local ofrece para reservar.
class OfertaCitas {
  const OfertaCitas({required this.disponible, required this.local, required this.color, required this.servicios});

  final bool disponible;
  final String local;
  final String color;
  final List<ServicioCita> servicios;
}

class DiaCita {
  const DiaCita({required this.fecha, required this.abierto, required this.libres});

  /// `2026-11-16` (día del local).
  final String fecha;
  final bool abierto;
  final int libres;
}

class HorarioCita {
  const HorarioCita({required this.id, required this.hora, required this.restantes, required this.disponible});

  final int id;
  final String hora;
  final int restantes;
  final bool disponible;
}

enum EstadoCita {
  reservada('Reservada'),
  confirmada('Confirmada'),
  checkin('Ya llegaste'),
  atendida('Atendida'),
  noShow('No asististe'),
  cancelada('Cancelada');

  const EstadoCita(this.texto);

  final String texto;

  static EstadoCita desde(String valor) => switch (valor) {
        'RESERVADA' => reservada,
        'CONFIRMADA' => confirmada,
        'CHECKIN' => checkin,
        'ATENDIDA' => atendida,
        'NO_SHOW' => noShow,
        _ => cancelada,
      };
}

/// Una cita del cliente (de cualquier local).
class Cita {
  const Cita({
    required this.token,
    required this.estado,
    required this.inicio,
    required this.inicioTexto,
    required this.localSlug,
    required this.local,
    required this.servicio,
    required this.codigo,
    required this.activa,
    this.turnoToken,
    this.turnoCodigo,
  });

  final String token;
  final EstadoCita estado;
  final DateTime? inicio;

  /// «lunes, 16 de noviembre, 09:00» en la hora del local.
  final String inicioTexto;
  final String localSlug;
  final String local;
  final String servicio;

  /// Código para el kiosco del local (check-in sin la app).
  final String codigo;

  /// Reservada o confirmada y aún no termina: se puede hacer check-in o cancelar.
  final bool activa;

  /// Turno creado al hacer check-in (para seguirlo como cualquier turno).
  final String? turnoToken;
  final String? turnoCodigo;
}

/// Sanción vigente en un local por no presentarse.
class Sancion {
  const Sancion({required this.local, required this.hastaTexto, required this.motivo});

  final String local;
  final String hastaTexto;
  final String motivo;
}

class MisCitas {
  const MisCitas(this.citas, this.sanciones);

  final List<Cita> citas;
  final List<Sancion> sanciones;
}

/// Resultado del check-in: el turno con que entra a la fila.
class LlegadaCita {
  const LlegadaCita({required this.turnoToken, required this.codigo, required this.tarde});

  final String turnoToken;
  final String codigo;

  /// Llegó tarde: entra como turno general.
  final bool tarde;
}

/// Puerto: citas en el servidor de TurnoYa (siempre con la sesión del cliente para reservar y ver las suyas).
/// Un local donde se puede reservar (directorio de la app: todos los registrados, no solo los visitados).
class LocalConCitas {
  const LocalConCitas({required this.slug, required this.nombre, this.rubro, this.ciudad, this.direccion, this.color, this.servicios = 0});

  final String slug;
  final String nombre;
  final String? rubro;
  final String? ciudad;
  final String? direccion;
  final String? color;

  /// Cuántos servicios atienden con cita.
  final int servicios;
}

abstract interface class ServicioCitas {
  /// Todos los locales activos que reciben reservas.
  Future<List<LocalConCitas>> localesConCitas();

  Future<OfertaCitas> ofertaCitas(String slug);

  Future<List<DiaCita>> diasCita(String slug, int servicioId);

  Future<List<HorarioCita>> horariosCita(String slug, int servicioId, String fecha);

  Future<MisCitas> misCitas(String sesion);

  Future<void> reservarCita(String sesion, {required String slug, required int servicioId, required int horarioId});

  Future<void> cancelarCita(String sesion, String token);

  /// [presencia]: marca del QR «App» de la TV del local (prueba de que llegó).
  Future<LlegadaCita> checkinCita(String sesion, String token, String presencia);
}
