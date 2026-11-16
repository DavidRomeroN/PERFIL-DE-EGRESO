/// Modelo del dominio: lo que la app sabe de un local y de un turno. Sin HTTP ni Flutter.
library;

/// Servicio (cola) de un local.
class Cola {
  const Cola({
    required this.id,
    required this.prefijo,
    required this.nombre,
    this.descripcion,
    required this.enEspera,
    required this.tiempoEstimadoSeg,
  });

  final int id;
  final String prefijo;
  final String nombre;
  final String? descripcion;
  final int enEspera;
  final int tiempoEstimadoSeg;

  int get minutosEstimados => (tiempoEstimadoSeg / 60).round();
}

/// Local donde se toma el turno (lo identifica su slug, que viene en el QR).
class Local {
  const Local({
    required this.slug,
    required this.nombre,
    this.direccion,
    required this.colorPrimario,
    required this.abierto,
    this.mensajeCerrado,
    required this.avisarFaltando,
    required this.colas,
    this.presencia,
    this.categorias = const [],
    this.conPrediccion = false,
  });

  final String slug;
  final String nombre;
  final String? direccion;
  final String colorPrimario;
  final bool abierto;
  final String? mensajeCerrado;

  /// Cuántas personas delante faltan para avisar al cliente.
  final int avisarFaltando;
  final List<Cola> colas;

  /// Marca de presencia del QR con que se abrió el local (nula si se escribió el código a mano).
  final String? presencia;

  /// Atención preferencial que ofrece el local (adulto mayor, gestante…). Vacía si no la usa.
  final List<Categoria> categorias;

  /// El local tiene el módulo de predicción: se pueden consultar las mejores horas para ir.
  final bool conPrediccion;

  Local conPresencia(String? marca) => Local(
        slug: slug,
        nombre: nombre,
        direccion: direccion,
        colorPrimario: colorPrimario,
        abierto: abierto,
        mensajeCerrado: mensajeCerrado,
        avisarFaltando: avisarFaltando,
        colas: colas,
        presencia: marca,
        categorias: categorias,
        conPrediccion: conPrediccion,
      );
}

enum EstadoTurno {
  emitido('En espera'),
  avisado('Avisado'),
  llamado('¡Es tu turno!'),
  atendido('Atendido'),
  noSePresento('No se presentó'),
  cancelado('Cancelado'),
  transferido('Transferido');

  const EstadoTurno(this.etiqueta);

  final String etiqueta;

  static EstadoTurno desde(String valor) => switch (valor) {
        'EMITIDO' => emitido,
        'AVISADO' => avisado,
        'LLAMADO' => llamado,
        'ATENDIDO' => atendido,
        'NO_SE_PRESENTO' => noSePresento,
        'CANCELADO' => cancelado,
        _ => transferido,
      };

  bool get enEspera => this == emitido || this == avisado;
  bool get finalizado => !enEspera && this != llamado;
}

/// Turno del cliente tal como lo devuelve la API pública.
class Turno {
  const Turno({
    required this.token,
    required this.codigo,
    required this.estado,
    required this.canal,
    required this.personasDelante,
    required this.tiempoEstimadoSeg,
    required this.cola,
    this.ventanilla,
    required this.localSlug,
    required this.localNombre,
    required this.colorPrimario,
    required this.avisarFaltando,
    required this.urlSeguimiento,
  });

  final String token;
  final String codigo;
  final EstadoTurno estado;

  /// APP, WHATSAPP, QR… (todos comparten la misma cola).
  final String canal;
  final int personasDelante;
  final int tiempoEstimadoSeg;
  final String cola;
  final String? ventanilla;
  final String localSlug;
  final String localNombre;
  final String colorPrimario;
  final int avisarFaltando;
  final String urlSeguimiento;

  int get minutosEstimados => tiempoEstimadoSeg < 60 ? 0 : (tiempoEstimadoSeg / 60).round();

  /// Regla de aviso: queda poco (según el local) o ya lo llamaron.
  bool get estaCerca => estado == EstadoTurno.llamado || (estado.enEspera && personasDelante <= avisarFaltando);

  /// Avance para la barra (8–100 %), misma fórmula que la web.
  double get progreso {
    if (!estado.enEspera) return 1;
    final p = 1 - personasDelante / (personasDelante + 3);
    return p < 0.08 ? 0.08 : p;
  }
}

/// Error de negocio que explica la API ({ok:false, error:{codigo, mensaje}}) o un problema de red.
class ErrorTurno implements Exception {
  const ErrorTurno(this.codigo, this.mensaje, [this.datos = const {}]);

  final String codigo;
  final String mensaje;

  /// Datos extra del error (p. ej. el `token` del turno que ya tenías, en `TURNO_DUPLICADO`).
  final Map<String, dynamic> datos;

  @override
  String toString() => mensaje;
}

/// Cuenta del cliente: con correo (registro en la app) o con su celular verificado por WhatsApp (enmascarado).
class Cuenta {
  const Cuenta({this.telefono, this.correo, this.nombre});

  final String? telefono;
  final String? correo;
  final String? nombre;

  /// Cómo se identifica la cuenta en pantalla: el correo o el celular.
  String get identificador => correo ?? telefono ?? 'Tu cuenta';

  /// Iniciales para el avatar.
  String get iniciales {
    final partes = (nombre ?? correo ?? '?').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (partes.isEmpty) return '?';
    return (partes.length == 1 ? partes.first.substring(0, 1) : partes[0].substring(0, 1) + partes[1].substring(0, 1)).toUpperCase();
  }
}

/// Sesión de la app: el token que identifica al cliente ante el servidor y los datos de su cuenta.
class Sesion {
  const Sesion({required this.token, required this.cuenta});

  final String token;
  final Cuenta cuenta;
}

/// Turno del historial del cliente. [token] solo viene en los turnos activos (para seguirlos).
class TurnoPasado {
  const TurnoPasado({
    this.token,
    required this.codigo,
    required this.estado,
    required this.cola,
    required this.local,
    required this.localSlug,
    this.emitidoAt,
  });

  final String? token;
  final String codigo;
  final EstadoTurno estado;
  final String cola;
  final String local;
  final String localSlug;
  final DateTime? emitidoAt;

  bool get activo => token != null;
}

/// Categoría de atención preferencial de un local. En la ventanilla se pide el [documento] que la acredita.
class Categoria {
  const Categoria({required this.codigo, required this.nombre, this.documento});

  final String codigo;
  final String nombre;
  final String? documento;

  /// `CARNE_GESTANTE` → «carné de gestante», para el aviso de qué llevar.
  String? get documentoLegible => switch (documento) {
        null || '' || 'NINGUNO' => null,
        'DNI' => 'DNI',
        'CARNE_GESTANTE' => 'carné de gestante',
        'CONADIS' => 'carné del CONADIS',
        'TRIAJE' => 'evaluación de triaje',
        final otro => otro.toLowerCase().replaceAll('_', ' '),
      };
}

/// Espera típica de una cola en una franja de media hora de hoy (predicción con 8 semanas de historia).
class FranjaEspera {
  const FranjaEspera({required this.franja, required this.esperaMin, required this.nivel});

  /// `"14:30"`.
  final String franja;
  final int esperaMin;

  /// `baja`, `media` o `alta` comparada con el resto del día.
  final String nivel;
}

/// Local que el cliente visitó (o marcó como favorito) para volver a verlo sin escanear.
class LocalGuardado {
  const LocalGuardado({required this.slug, required this.nombre, required this.colorPrimario, required this.ultimaVisita, this.favorito = false});

  final String slug;
  final String nombre;
  final String colorPrimario;
  final DateTime ultimaVisita;
  final bool favorito;

  LocalGuardado copiar({String? nombre, String? colorPrimario, DateTime? ultimaVisita, bool? favorito}) => LocalGuardado(
        slug: slug,
        nombre: nombre ?? this.nombre,
        colorPrimario: colorPrimario ?? this.colorPrimario,
        ultimaVisita: ultimaVisita ?? this.ultimaVisita,
        favorito: favorito ?? this.favorito,
      );

  Map<String, Object> aJson() =>
      {'slug': slug, 'nombre': nombre, 'color': colorPrimario, 'visita': ultimaVisita.toIso8601String(), 'favorito': favorito};

  static LocalGuardado? desdeJson(Object? j) {
    if (j is! Map) return null;
    final visita = DateTime.tryParse(j['visita'] as String? ?? '');
    if (j['slug'] is! String || j['nombre'] is! String || visita == null) return null;
    return LocalGuardado(
      slug: j['slug'] as String,
      nombre: j['nombre'] as String,
      colorPrimario: j['color'] as String? ?? '#2563eb',
      ultimaVisita: visita,
      favorito: j['favorito'] == true,
    );
  }
}

/// Turno al que el cliente no se presentó.
class Falta {
  const Falta({required this.fecha, required this.codigo, required this.cola, required this.local});

  final DateTime fecha;
  final String codigo;
  final String cola;
  final String local;
}

/// Perfil de la cuenta y su estado antifraude: faltas de los últimos días, bloqueo y turnos activos.
class Perfil {
  const Perfil({
    required this.cuenta,
    this.miembroDesde,
    required this.faltas,
    required this.maxFaltas,
    required this.diasFaltas,
    this.bloqueadoHasta,
    required this.activos,
    required this.maxActivos,
  });

  final Cuenta cuenta;
  final DateTime? miembroDesde;
  final List<Falta> faltas;
  final int maxFaltas;
  final int diasFaltas;
  final DateTime? bloqueadoHasta;
  final int activos;
  final int maxActivos;

  bool get bloqueado => bloqueadoHasta != null && bloqueadoHasta!.isAfter(DateTime.now());

  /// Cuántas faltas más lo bloquearían (0 si ya está bloqueado).
  int get faltasRestantes => bloqueado ? 0 : (maxFaltas - faltas.length).clamp(0, maxFaltas);
}
