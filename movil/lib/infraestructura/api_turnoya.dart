import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../dominio/modelos.dart';
import '../dominio/puertos.dart';

/// Adaptador HTTP del servidor TurnoYa: API pública (`{ok, data}` / `{ok:false, error}`) y canal en vivo por
/// Server-Sent Events (`/api/v1/realtime/<slug>`).
class ApiTurnoYa implements ServicioTurnos {
  ApiTurnoYa(String urlBase, {http.Client? cliente})
      : _base = urlBase.endsWith('/') ? urlBase.substring(0, urlBase.length - 1) : urlBase,
        _http = cliente ?? http.Client();

  final String _base;
  final http.Client _http;
  static const _tiempo = Duration(seconds: 15);

  @override
  Future<Local> obtenerLocal(String slug) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/public/locales/$slug')));
    return Local(
      slug: d['slug'] as String,
      nombre: d['nombreComercial'] as String,
      direccion: d['direccion'] as String?,
      colorPrimario: (d['colorPrimario'] as String?) ?? '#2563eb',
      abierto: d['abierto'] as bool? ?? true,
      mensajeCerrado: d['mensajeCerrado'] as String?,
      avisarFaltando: (d['avisarFaltando'] as num?)?.toInt() ?? 1,
      colas: [
        for (final c in (d['colas'] as List? ?? const []).cast<Map<String, dynamic>>())
          Cola(
            id: (c['id'] as num).toInt(),
            prefijo: c['prefijo'] as String,
            nombre: c['nombre'] as String,
            descripcion: c['descripcion'] as String?,
            enEspera: (c['enEspera'] as num).toInt(),
            tiempoEstimadoSeg: (c['tiempoEstimadoSeg'] as num).toInt(),
          ),
      ],
      categorias: [
        for (final c in (d['categorias'] as List? ?? const []).cast<Map<String, dynamic>>())
          Categoria(codigo: c['codigo'] as String, nombre: c['nombre'] as String, documento: c['documento'] as String?),
      ],
      conPrediccion: (d['modulos'] as Map<String, dynamic>?)?['prediccion'] == true,
    );
  }

  @override
  Future<Turno> tomarTurno(
      {required int colaId, String? nombre, String? categoria, String? presencia, required String dispositivo, String? sesion}) async {
    final cuerpo =
        jsonEncode({'colaId': colaId, 'nombre': nombre, 'categoriaCodigo': categoria, 'presencia': presencia, 'dispositivo': dispositivo});
    return _turno(await _pedir(() => _http.post(_uri('/api/v1/public/app/turnos'), headers: _cabeceras(sesion), body: cuerpo)));
  }

  @override
  Future<List<FranjaEspera>> mejoresHoras(int colaId) async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/public/colas/$colaId/mejores-horas'))) as List? ?? const [];
    return [
      for (final f in lista.cast<Map<String, dynamic>>())
        FranjaEspera(
          franja: f['franja'] as String? ?? '',
          esperaMin: (f['esperaMin'] as num?)?.toInt() ?? 0,
          nivel: f['nivel'] as String? ?? 'media',
        ),
    ];
  }

  @override
  Future<void> pedirCodigo({required String slug, required String telefono}) async {
    await _pedir(() => _http.post(_uri('/api/v1/public/app/codigo'),
        headers: _cabeceras(null), body: jsonEncode({'slug': slug, 'telefono': telefono})));
  }

  @override
  Future<Sesion> abrirSesion({required String telefono, required String codigo, String? nombre, required String dispositivo}) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/public/app/sesion'),
        headers: _cabeceras(null),
        body: jsonEncode({'telefono': telefono, 'codigo': codigo, 'nombre': nombre, 'consentimiento': true, 'dispositivo': dispositivo})));
    return _sesion(d);
  }

  @override
  Future<Sesion> registrar({required String correo, required String clave, required String nombre, required String dispositivo}) async =>
      _sesion(await _pedir(() => _http.post(_uri('/api/v1/public/app/registro'),
          headers: _cabeceras(null),
          body: jsonEncode({'correo': correo, 'clave': clave, 'nombre': nombre, 'consentimiento': true, 'dispositivo': dispositivo}))));

  @override
  Future<Sesion> ingresar({required String correo, required String clave, required String dispositivo}) async =>
      _sesion(await _pedir(() => _http.post(_uri('/api/v1/public/app/ingreso'),
          headers: _cabeceras(null), body: jsonEncode({'correo': correo, 'clave': clave, 'dispositivo': dispositivo}))));

  @override
  Future<Perfil> perfil(String sesion, String dispositivo) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/public/app/perfil'), headers: {..._cabeceras(sesion), 'X-Dispositivo': dispositivo}));
    final c = d['conducta'] as Map<String, dynamic>? ?? const {};
    DateTime? fecha(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
    return Perfil(
      cuenta: Cuenta(nombre: d['nombre'] as String?, correo: d['correo'] as String?, telefono: d['telefono'] as String?),
      miembroDesde: fecha(d['miembroDesde']),
      faltas: [
        for (final f in (c['faltas'] as List? ?? const []).cast<Map<String, dynamic>>())
          Falta(
            fecha: fecha(f['fecha']) ?? DateTime.now(),
            codigo: f['codigo'] as String? ?? '',
            cola: f['cola'] as String? ?? '',
            local: f['local'] as String? ?? '',
          ),
      ],
      maxFaltas: (c['maxFaltas'] as num?)?.toInt() ?? 3,
      diasFaltas: (c['diasFaltas'] as num?)?.toInt() ?? 7,
      bloqueadoHasta: fecha(c['bloqueadoHasta']),
      activos: (c['activos'] as num?)?.toInt() ?? 0,
      maxActivos: (c['maxActivos'] as num?)?.toInt() ?? 1,
    );
  }

  static Sesion _sesion(Map<String, dynamic> d) => Sesion(
        token: d['token'] as String,
        cuenta: Cuenta(telefono: d['telefono'] as String?, correo: d['correo'] as String?, nombre: d['nombre'] as String?),
      );

  @override
  Future<void> cerrarSesion(String sesion) async {
    await _pedir(() => _http.delete(_uri('/api/v1/public/app/sesion'), headers: _cabeceras(sesion)));
  }

  @override
  Future<List<TurnoPasado>> historial(String sesion) async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/public/app/turnos'), headers: _cabeceras(sesion))) as List? ?? const [];
    return [
      for (final t in lista.cast<Map<String, dynamic>>())
        TurnoPasado(
          token: t['token'] as String?,
          codigo: t['codigo'] as String? ?? '',
          estado: EstadoTurno.desde(t['estado'] as String? ?? ''),
          cola: t['cola'] as String? ?? '',
          local: t['local'] as String? ?? '',
          localSlug: t['localSlug'] as String? ?? '',
          emitidoAt: DateTime.tryParse(t['emitidoAt'] as String? ?? '')?.toLocal(),
        ),
    ];
  }

  /// JSON y, con sesión, el token del cliente.
  static Map<String, String> _cabeceras(String? sesion) => {
        'Content-Type': 'application/json',
        if (sesion != null) 'Authorization': 'Bearer $sesion',
      };

  @override
  Future<Turno> consultarTurno(String token) async => _turno(await _pedir(() => _http.get(_uri('/api/v1/public/turnos/$token'))));

  @override
  Future<Turno> cancelarTurno(String token) async => _turno(await _pedir(() => _http.delete(_uri('/api/v1/public/turnos/$token'))));

  @override
  Stream<void> cambiosDelLocal(String slug) {
    late StreamController<void> salida;
    http.Client? conexion;
    var activo = true;

    Future<void> conectar() async {
      while (activo) {
        conexion = http.Client();
        try {
          final peticion = http.Request('GET', _uri('/api/v1/realtime/$slug'))..headers['Accept'] = 'text/event-stream';
          final respuesta = await conexion!.send(peticion);
          await for (final linea in respuesta.stream.transform(utf8.decoder).transform(const LineSplitter())) {
            // Cada "event: <tipo>" es un cambio del local; "conectado" y los comentarios (ping) no
            if (linea.startsWith('event:') && !linea.contains('conectado')) salida.add(null);
          }
        } on Object {
          // Se cortó la conexión: se reintenta en unos segundos
        } finally {
          conexion?.close();
        }
        if (activo) await Future<void>.delayed(const Duration(seconds: 5));
      }
    }

    salida = StreamController<void>(
      onListen: conectar,
      onCancel: () {
        activo = false;
        conexion?.close();
      },
    );
    return salida.stream;
  }

  Uri _uri(String ruta) => Uri.parse('$_base$ruta');

  Future<Map<String, dynamic>> _pedir(Future<http.Response> Function() hacer) async =>
      (await _pedirDato(hacer) as Map<String, dynamic>?) ?? const {};

  /// Hace la petición y devuelve `data`; con `{ok:false}` lanza [ErrorTurno] con el código, el mensaje y los datos extra.
  Future<Object?> _pedirDato(Future<http.Response> Function() hacer) async {
    final http.Response r;
    try {
      r = await hacer().timeout(_tiempo);
    } on TimeoutException {
      throw const ErrorTurno('SIN_RED', 'El servidor no responde. Revisa tu conexión.');
    } on Object {
      throw const ErrorTurno('SIN_RED', 'No hay conexión con TurnoYa. Revisa tu internet.');
    }
    Map<String, dynamic> json;
    try {
      json = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    } on FormatException {
      throw ErrorTurno('RESPUESTA_INVALIDA', 'Respuesta inesperada del servidor (${r.statusCode}).');
    }
    if (json['ok'] == true) return json['data'];
    final error = json['error'] as Map<String, dynamic>? ?? const {};
    final datos = Map<String, dynamic>.of(error)
      ..remove('codigo')
      ..remove('mensaje');
    throw ErrorTurno(error['codigo'] as String? ?? 'ERROR', error['mensaje'] as String? ?? 'No se pudo completar la operación.', datos);
  }

  static Turno _turno(Map<String, dynamic> d) {
    final local = d['local'] as Map<String, dynamic>? ?? const {};
    final cola = d['cola'] as Map<String, dynamic>? ?? const {};
    final ventanilla = d['ventanilla'] as Map<String, dynamic>?;
    return Turno(
      token: d['token'] as String,
      codigo: (d['codigo'] ?? d['codigoProvisional']) as String,
      estado: EstadoTurno.desde(d['estado'] as String),
      canal: d['canal'] as String? ?? 'APP',
      personasDelante: (d['personasDelante'] as num?)?.toInt() ?? 0,
      tiempoEstimadoSeg: (d['tiempoEstimadoSeg'] as num?)?.toInt() ?? 0,
      cola: cola['nombre'] as String? ?? '',
      ventanilla: ventanilla?['nombre'] as String?,
      localSlug: local['slug'] as String? ?? '',
      localNombre: local['nombreComercial'] as String? ?? '',
      colorPrimario: local['colorPrimario'] as String? ?? '#2563eb',
      avisarFaltando: (local['avisarFaltando'] as num?)?.toInt() ?? 1,
      urlSeguimiento: d['urlSeguimiento'] as String? ?? '',
    );
  }
}
