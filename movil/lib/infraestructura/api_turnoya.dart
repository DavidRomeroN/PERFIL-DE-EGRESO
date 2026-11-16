import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../dominio/citas.dart';
import '../dominio/modelos.dart';
import '../dominio/personal.dart';
import '../dominio/puertos.dart';

/// Adaptador HTTP del servidor TurnoYa: API pública (`{ok, data}` / `{ok:false, error}`) y canal en vivo por
/// Server-Sent Events (`/api/v1/realtime/<slug>`).
class ApiTurnoYa implements ServicioTurnos, ServicioCitas, ServicioPersonal {
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

  // --- Citas ---

  @override
  Future<List<LocalConCitas>> localesConCitas() async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/public/locales-con-citas'))) as List? ?? const [];
    return [
      for (final l in lista.cast<Map<String, dynamic>>())
        LocalConCitas(
          slug: l['slug'] as String,
          nombre: l['nombre'] as String? ?? '',
          rubro: l['rubro'] as String?,
          ciudad: l['ciudad'] as String?,
          direccion: l['direccion'] as String?,
          color: l['colorPrimario'] as String?,
          servicios: (l['servicios'] as num?)?.toInt() ?? 0,
        ),
    ];
  }

  @override
  Future<OfertaCitas> ofertaCitas(String slug) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/public/locales/$slug/citas')));
    final local = d['local'] as Map<String, dynamic>? ?? const {};
    return OfertaCitas(
      disponible: d['disponible'] as bool? ?? false,
      local: local['nombre'] as String? ?? '',
      color: local['color'] as String? ?? '#2563eb',
      servicios: [
        for (final c in (d['colas'] as List? ?? const []).cast<Map<String, dynamic>>())
          ServicioCita(
            id: (c['id'] as num).toInt(),
            nombre: c['nombre'] as String? ?? '',
            descripcion: c['descripcion'] as String?,
            duracionMin: ((c['configCitas'] as Map<String, dynamic>?)?['duracionSlotMin'] as num?)?.toInt() ?? 15,
            diasMax: ((c['configCitas'] as Map<String, dynamic>?)?['anticipacionMaxDias'] as num?)?.toInt() ?? 14,
          ),
      ],
    );
  }

  @override
  Future<List<DiaCita>> diasCita(String slug, int servicioId) async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/public/locales/$slug/disponibilidad?colaId=$servicioId'))) as List? ?? const [];
    return [
      for (final d in lista.cast<Map<String, dynamic>>())
        DiaCita(fecha: d['fecha'] as String, abierto: d['abierto'] as bool? ?? false, libres: (d['libres'] as num?)?.toInt() ?? 0),
    ];
  }

  @override
  Future<List<HorarioCita>> horariosCita(String slug, int servicioId, String fecha) async {
    final lista =
        await _pedirDato(() => _http.get(_uri('/api/v1/public/locales/$slug/slots?colaId=$servicioId&fecha=$fecha'))) as List? ?? const [];
    return [
      for (final s in lista.cast<Map<String, dynamic>>())
        HorarioCita(
          id: (s['id'] as num).toInt(),
          hora: s['hora'] as String? ?? '',
          restantes: (s['restantes'] as num?)?.toInt() ?? 0,
          disponible: s['disponible'] as bool? ?? false,
        ),
    ];
  }

  @override
  Future<MisCitas> misCitas(String sesion) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/public/app/citas'), headers: _cabeceras(sesion)));
    return MisCitas(
      [
        for (final c in (d['citas'] as List? ?? const []).cast<Map<String, dynamic>>())
          Cita(
            token: c['token'] as String,
            estado: EstadoCita.desde(c['estado'] as String? ?? ''),
            inicio: DateTime.tryParse(c['inicio'] as String? ?? '')?.toLocal(),
            inicioTexto: c['inicioTexto'] as String? ?? '',
            localSlug: c['localSlug'] as String? ?? '',
            local: c['local'] as String? ?? '',
            servicio: c['servicio'] as String? ?? '',
            codigo: c['codigoCheckin'] as String? ?? '',
            activa: c['activa'] as bool? ?? false,
            turnoToken: c['turnoToken'] as String?,
            turnoCodigo: c['turnoCodigo'] as String?,
          ),
      ],
      [
        for (final s in (d['sanciones'] as List? ?? const []).cast<Map<String, dynamic>>())
          Sancion(local: s['local'] as String? ?? '', hastaTexto: s['hastaTexto'] as String? ?? '', motivo: s['motivo'] as String? ?? ''),
      ],
    );
  }

  @override
  Future<void> reservarCita(String sesion, {required String slug, required int servicioId, required int horarioId}) async {
    await _pedir(() => _http.post(_uri('/api/v1/public/app/citas'),
        headers: _cabeceras(sesion), body: jsonEncode({'slug': slug, 'colaId': servicioId, 'slotId': horarioId})));
  }

  @override
  Future<void> cancelarCita(String sesion, String token) async {
    await _pedir(() => _http.delete(_uri('/api/v1/public/app/citas/$token'), headers: _cabeceras(sesion)));
  }

  @override
  Future<LlegadaCita> checkinCita(String sesion, String token, String presencia) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/public/app/citas/$token/checkin'),
        headers: _cabeceras(sesion), body: jsonEncode({'presencia': presencia})));
    return LlegadaCita(turnoToken: d['turnoToken'] as String? ?? '', codigo: d['codigo'] as String? ?? '', tarde: d['tarde'] as bool? ?? false);
  }

  // --- Personal del negocio (`/api/v1` con el token del personal) ---

  @override
  Future<SesionPersonal> ingresarPersonal(String correo, String clave) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/auth/movil'),
        headers: _cabeceras(null), body: jsonEncode({'email': correo.trim(), 'password': clave})));
    final s = d['sesion'] as Map<String, dynamic>? ?? const {};
    return SesionPersonal(
      token: d['token'] as String,
      nombre: s['nombre'] as String? ?? '',
      rol: s['rol'] as String? ?? 'OPERADOR',
      local: s['localNombre'] as String? ?? s['localSlug'] as String? ?? '',
    );
  }

  static TurnoPersonal _turnoPersonal(Map<String, dynamic> t) => TurnoPersonal(
        id: (t['id'] as num).toInt(),
        codigo: (t['codigo'] ?? t['codigoProvisional'] ?? '') as String,
        nombre: t['nombre'] as String?,
        canal: t['canal'] as String? ?? '',
        rellamadas: (t['rellamadas'] as num?)?.toInt() ?? 0,
        categoria: t['categoria'] as String?,
      );

  @override
  Future<PanelPersonal> panel(String token) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/movil/panel'), headers: _cabeceras(token)));
    return PanelPersonal(
      usuario: d['usuario'] as String? ?? '',
      esAdmin: d['esAdmin'] as bool? ?? false,
      local: d['local'] as String? ?? '',
      slug: d['slug'] as String? ?? '',
      plan: d['plan'] as String?,
      whatsapp: d['whatsapp'] as bool? ?? false,
      ventanillas: [
        for (final v in (d['ventanillas'] as List? ?? const []).cast<Map<String, dynamic>>())
          VentanillaPersonal(
            id: (v['id'] as num).toInt(),
            nombre: v['nombre'] as String? ?? '',
            colaId: (v['colaId'] as num).toInt(),
            cola: v['cola'] as String? ?? '',
            prefijo: v['prefijo'] as String? ?? '',
            enEspera: (v['enEspera'] as num?)?.toInt() ?? 0,
            actual: v['actual'] == null ? null : _turnoPersonal(v['actual'] as Map<String, dynamic>),
            siguientes: [for (final t in (v['siguientes'] as List? ?? const []).cast<Map<String, dynamic>>()) _turnoPersonal(t)],
          ),
      ],
      colasTicket: [
        for (final c in (d['colasTicket'] as List? ?? const []).cast<Map<String, dynamic>>())
          ColaTicket(id: (c['id'] as num).toInt(), nombre: c['nombre'] as String? ?? '', prefijo: c['prefijo'] as String? ?? ''),
      ],
    );
  }

  @override
  Future<TurnoPersonal?> llamarSiguiente(String token, int ventanillaId) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/ventanillas/$ventanillaId/llamar-siguiente'), headers: _cabeceras(token)));
    final t = d['turno'] as Map<String, dynamic>?;
    return t == null ? null : _turnoPersonal(t);
  }

  @override
  Future<void> marcarTurno(String token, int turnoId, String estado) async {
    await _pedir(() => _http.patch(_uri('/api/v1/turnos/$turnoId/estado'), headers: _cabeceras(token), body: jsonEncode({'estado': estado})));
  }

  @override
  Future<TicketEmitido> emitirTicket(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false}) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/turnos/ticket'),
        headers: _cabeceras(token),
        body: jsonEncode({'colaId': colaId, 'nombre': nombre, 'telefono': telefono, 'consentimiento': consentimiento})));
    return TicketEmitido(codigo: (d['codigo'] ?? '') as String, token: (d['token'] ?? '') as String);
  }

  @override
  Future<PanelKiosco> panelKiosco(String token) async {
    final d = await _pedir(() => _http.get(_uri('/api/v1/movil/kiosco'), headers: _cabeceras(token)));
    return PanelKiosco(
      usuario: d['usuario'] as String? ?? '',
      local: d['local'] as String? ?? '',
      slug: d['slug'] as String? ?? '',
      whatsapp: d['whatsapp'] as bool? ?? false,
      puedeTransferir: d['puedeTransferir'] as bool? ?? false,
      colas: [
        for (final c in (d['colas'] as List? ?? const []).cast<Map<String, dynamic>>())
          ColaKiosco(
            id: (c['id'] as num).toInt(),
            nombre: c['nombre'] as String? ?? '',
            prefijo: c['prefijo'] as String? ?? '',
            enEspera: (c['enEspera'] as num?)?.toInt() ?? 0,
            tiempoEstimadoSeg: (c['tiempoEstimadoSeg'] as num?)?.toInt() ?? 0,
          ),
      ],
      espera: [
        for (final t in (d['espera'] as List? ?? const []).cast<Map<String, dynamic>>())
          EsperaKiosco(
            id: (t['id'] as num).toInt(),
            codigo: t['codigo'] as String? ?? '',
            nombre: t['nombre'] as String?,
            canal: t['canal'] as String? ?? '',
            emitidoAt: DateTime.tryParse(t['emitidoAt'] as String? ?? '')?.toLocal() ?? DateTime.now(),
            colaId: (t['colaId'] as num).toInt(),
            cola: t['cola'] as String? ?? '',
            prefijo: t['prefijo'] as String? ?? '',
          ),
      ],
    );
  }

  @override
  Future<TicketEmitido> emitirTicketKiosco(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false}) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/movil/kiosco/ticket'),
        headers: _cabeceras(token),
        body: jsonEncode({'colaId': colaId, 'nombre': nombre, 'telefono': telefono, 'consentimiento': consentimiento})));
    return TicketEmitido(codigo: (d['codigo'] ?? '') as String, token: (d['token'] ?? '') as String);
  }

  @override
  Future<String> transferir(String token, int turnoId, int aColaId) async {
    final d = await _pedir(() => _http.post(_uri('/api/v1/movil/kiosco/transferir'),
        headers: _cabeceras(token), body: jsonEncode({'turnoId': turnoId, 'aColaId': aColaId})));
    return (d['codigo'] ?? d['codigoProvisional'] ?? '') as String;
  }

  @override
  Future<List<ColaNegocio>> colas(String token) async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/colas'), headers: _cabeceras(token))) as List? ?? const [];
    return [
      for (final c in lista.cast<Map<String, dynamic>>())
        ColaNegocio(
          id: (c['id'] as num).toInt(),
          prefijo: c['prefijo'] as String? ?? '',
          nombre: c['nombre'] as String? ?? '',
          activa: c['activa'] as bool? ?? true,
          ventanillas: [for (final v in (c['ventanillas'] as List? ?? const []).cast<Map<String, dynamic>>()) v['nombre'] as String? ?? ''],
        ),
    ];
  }

  @override
  Future<void> crearCola(String token, {required String prefijo, required String nombre}) async {
    await _pedir(() => _http.post(_uri('/api/v1/colas'), headers: _cabeceras(token), body: jsonEncode({'prefijo': prefijo, 'nombre': nombre})));
  }

  @override
  Future<void> activarCola(String token, int id, bool activa) async {
    await _pedir(() => _http.patch(_uri('/api/v1/colas/$id'), headers: _cabeceras(token), body: jsonEncode({'activa': activa})));
  }

  @override
  Future<void> eliminarCola(String token, int id) async {
    await _pedir(() => _http.delete(_uri('/api/v1/colas/$id'), headers: _cabeceras(token)));
  }

  @override
  Future<List<VentanillaNegocio>> ventanillas(String token) async {
    final lista = await _pedirDato(() => _http.get(_uri('/api/v1/ventanillas'), headers: _cabeceras(token))) as List? ?? const [];
    return [
      for (final v in lista.cast<Map<String, dynamic>>())
        VentanillaNegocio(
          id: (v['id'] as num).toInt(),
          nombre: v['nombre'] as String? ?? '',
          activa: v['activa'] as bool? ?? true,
          colaId: (v['colaId'] as num?)?.toInt(),
          cola: (v['cola'] as Map<String, dynamic>?)?['nombre'] as String?,
        ),
    ];
  }

  @override
  Future<void> crearVentanilla(String token, {required String nombre, required int colaId}) async {
    await _pedir(() => _http.post(_uri('/api/v1/ventanillas'), headers: _cabeceras(token), body: jsonEncode({'nombre': nombre, 'colaId': colaId})));
  }

  @override
  Future<void> editarVentanilla(String token, int id, {String? nombre, bool? activa}) async {
    await _pedir(() => _http.patch(_uri('/api/v1/ventanillas/$id'),
        headers: _cabeceras(token), body: jsonEncode({'nombre': ?nombre, 'activa': ?activa})));
  }

  static WhatsAppNegocio _whatsapp(Map<String, dynamic> d) => WhatsAppNegocio(
        configurado: d['configurado'] as bool? ?? false,
        estado: d['estado'] as String? ?? 'sin_sesion',
        telefono: d['telefono'] as String?,
        nombre: d['nombre'] as String?,
        numero: d['numeroLocal'] as String?,
        codigo: d['codigo'] as String?,
        error: d['error'] as String?,
      );

  @override
  Future<WhatsAppNegocio> whatsapp(String token) async =>
      _whatsapp(await _pedir(() => _http.get(_uri('/api/v1/whatsapp/conexion'), headers: _cabeceras(token))));

  @override
  Future<WhatsAppNegocio> accionWhatsapp(String token, String accion, {String? telefono}) async =>
      _whatsapp(await _pedir(() => _http.post(_uri('/api/v1/whatsapp/conexion'),
          headers: _cabeceras(token), body: jsonEncode({'accion': accion, 'telefono': ?telefono}))));

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
      throw ErrorTurno('SIN_RED', 'El servidor no responde ($_base). Revisa tu conexión.');
    } on Object {
      throw ErrorTurno('SIN_RED', 'No hay conexión con TurnoYa ($_base). Revisa tu internet.');
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
