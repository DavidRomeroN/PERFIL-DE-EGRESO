/// Casos de uso de la app: orquestan los puertos del dominio. No conocen Flutter ni HTTP.
library;

import 'dart:async';

import '../dominio/citas.dart';
import '../dominio/codigo_qr.dart';
import '../dominio/modelos.dart';
import '../dominio/personal.dart';
import '../dominio/puertos.dart';

/// Escanear el QR de la TV y ver los servicios del local.
class AbrirLocal {
  AbrirLocal(this._servicio, {this.misLocales});

  final ServicioTurnos _servicio;

  /// Donde se anota el local abierto para "Mis locales" (opcional).
  final MisLocales? misLocales;

  /// El local queda con la marca de presencia del QR (si la trae): sin ella el servidor no deja tomar turno.
  Future<Local> desdeQr(String contenido) async {
    final datos = leerQr(contenido);
    if (datos == null) {
      throw const ErrorTurno('QR_INVALIDO', 'Ese QR no es de un local TurnoYa. Escanea el QR de la app que aparece en la pantalla.');
    }
    final local = (await _servicio.obtenerLocal(datos.slug)).conPresencia(datos.presencia);
    await misLocales?.recordar(local);
    return local;
  }
}

/// Locales visitados y favoritos: se ven sin escanear (solo para mirar la espera; para tomar turno hay que estar allí).
class MisLocales {
  MisLocales(this._almacen, {DateTime Function()? reloj}) : _reloj = reloj ?? DateTime.now;

  final AlmacenLocales _almacen;
  final DateTime Function() _reloj;

  /// Cuántos locales no favoritos se recuerdan (los más recientes).
  static const maximoRecientes = 15;

  /// Favoritos primero; luego por visita más reciente.
  Future<List<LocalGuardado>> call() async {
    final lista = [...await _almacen.leer()];
    lista.sort((a, b) => a.favorito != b.favorito ? (a.favorito ? -1 : 1) : b.ultimaVisita.compareTo(a.ultimaVisita));
    return lista;
  }

  Future<void> recordar(Local local) async {
    final lista = [...await _almacen.leer()];
    final i = lista.indexWhere((l) => l.slug == local.slug);
    final ahora = _reloj();
    if (i >= 0) {
      lista[i] = lista[i].copiar(nombre: local.nombre, colorPrimario: local.colorPrimario, ultimaVisita: ahora);
    } else {
      lista.add(LocalGuardado(slug: local.slug, nombre: local.nombre, colorPrimario: local.colorPrimario, ultimaVisita: ahora));
    }
    // Los favoritos no se pierden; de los demás se guardan solo los más recientes
    final recientes = lista.where((l) => !l.favorito).toList()..sort((a, b) => b.ultimaVisita.compareTo(a.ultimaVisita));
    final sobran = recientes.skip(maximoRecientes).map((l) => l.slug).toSet();
    await _almacen.guardar([for (final l in lista) if (!sobran.contains(l.slug)) l]);
  }

  Future<void> alternarFavorito(String slug) async {
    final lista = await _almacen.leer();
    await _almacen.guardar([for (final l in lista) l.slug == slug ? l.copiar(favorito: !l.favorito) : l]);
  }

  Future<void> olvidar(String slug) async {
    final lista = await _almacen.leer();
    await _almacen.guardar([for (final l in lista) if (l.slug != slug) l]);
  }

  /// Deshacer: vuelve a guardar la lista tal como estaba.
  Future<void> restaurar(List<LocalGuardado> locales) => _almacen.guardar(locales);
}

/// Mejores horas de hoy para ir a una cola, según la espera de las últimas semanas.
class MejoresHoras {
  MejoresHoras(this._servicio);

  final ServicioTurnos _servicio;

  Future<List<FranjaEspera>> call(int colaId) => _servicio.mejoresHoras(colaId);
}

/// Tomar turno en una cola y recordarlo para seguirlo después. Va con la marca de presencia del QR, el
/// identificador del teléfono (un turno activo por teléfono) y, si el cliente ingresó, su sesión.
class TomarTurno {
  TomarTurno(this._servicio, this._almacen, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenTurno _almacen;
  final AlmacenCuenta _cuenta;

  /// [categoria]: código de atención preferencial (en la ventanilla se pide el documento que la acredita).
  Future<Turno> call({required Local local, required int colaId, String? nombre, String? categoria}) async {
    if (local.presencia == null) {
      throw const ErrorTurno('APP_QR_VENCIDO',
          'Para tomar turno escanea el QR «App» de la pantalla del local (desde «Mis locales» solo se ve la espera).');
    }
    final limpio = nombre?.trim();
    final sesion = await _cuenta.leerSesion();
    try {
      final turno = await _servicio.tomarTurno(
        colaId: colaId,
        nombre: (limpio == null || limpio.isEmpty) ? null : limpio,
        categoria: local.categorias.any((c) => c.codigo == categoria) ? categoria : null,
        presencia: local.presencia,
        dispositivo: await _cuenta.dispositivo(),
        sesion: sesion?.token,
      );
      await _almacen.guardar(turno.token);
      return turno;
    } on ErrorTurno catch (e) {
      // Ya tenías un turno activo: se retoma en vez de mostrar un error
      final previo = e.datos['token'];
      if (e.codigo == 'TURNO_DUPLICADO' && previo is String) {
        final turno = await _servicio.consultarTurno(previo);
        await _almacen.guardar(turno.token);
        return turno;
      }
      if (e.codigo == 'APP_SESION_INVALIDA') await _cuenta.borrarSesion();
      rethrow;
    }
  }
}

/// Primer paso para ingresar: el código de 6 dígitos llega por el WhatsApp del local.
class PedirCodigo {
  PedirCodigo(this._servicio);

  final ServicioTurnos _servicio;

  Future<void> call({required String slug, required String telefono}) {
    final limpio = telefono.replaceAll(RegExp(r'[\s-]'), '');
    if (!RegExp(r'^\+?\d{9,15}$').hasMatch(limpio)) {
      throw const ErrorTurno('TELEFONO_INVALIDO', 'Escribe tu número de celular (9 dígitos).');
    }
    return _servicio.pedirCodigo(slug: slug, telefono: limpio);
  }
}

/// Segundo paso: verifica el código, abre la sesión y la guarda cifrada.
class IniciarSesion {
  IniciarSesion(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  Future<Sesion> call({required String telefono, required String codigo, String? nombre}) async {
    final limpio = nombre?.trim();
    final sesion = await _servicio.abrirSesion(
      telefono: telefono.replaceAll(RegExp(r'[\s-]'), ''),
      codigo: codigo.trim(),
      nombre: (limpio == null || limpio.isEmpty) ? null : limpio,
      dispositivo: await _cuenta.dispositivo(),
    );
    await _cuenta.guardarSesion(sesion);
    return sesion;
  }
}

/// La cuenta con que el cliente ingresó (nula si no ingresó).
class CuentaActual {
  CuentaActual(this._cuenta);

  final AlmacenCuenta _cuenta;

  Future<Cuenta?> call() async => (await _cuenta.leerSesion())?.cuenta;
}

/// Cierra la sesión en el servidor y la borra del teléfono (aunque no haya red).
class CerrarSesion {
  CerrarSesion(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  Future<void> call() async {
    final sesion = await _cuenta.leerSesion();
    try {
      if (sesion != null) await _servicio.cerrarSesion(sesion.token);
    } on ErrorTurno {
      // Sin red o sesión ya vencida: igual se olvida en el teléfono
    } finally {
      await _cuenta.borrarSesion();
    }
  }
}

/// Historial de turnos del cliente en todos los locales.
class VerHistorial {
  VerHistorial(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  Future<List<TurnoPasado>> call() async {
    final sesion = await _cuenta.leerSesion();
    if (sesion == null) throw const ErrorTurno('APP_SESION_INVALIDA', 'Ingresa con tu celular para ver tus turnos.');
    try {
      return await _servicio.historial(sesion.token);
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') await _cuenta.borrarSesion();
      rethrow;
    }
  }
}

/// Retomar un turno activo del historial para seguirlo.
class RetomarTurno {
  RetomarTurno(this._servicio, this._almacen);

  final ServicioTurnos _servicio;
  final AlmacenTurno _almacen;

  Future<Turno> call(String token) async {
    final turno = await _servicio.consultarTurno(token);
    if (!turno.estado.finalizado) await _almacen.guardar(turno.token);
    return turno;
  }
}

/// Al abrir la app: si hay un turno guardado y sigue activo, se retoma.
class RecuperarTurno {
  RecuperarTurno(this._servicio, this._almacen);

  final ServicioTurnos _servicio;
  final AlmacenTurno _almacen;

  Future<Turno?> call() async {
    final token = await _almacen.leer();
    if (token == null) return null;
    try {
      final turno = await _servicio.consultarTurno(token);
      if (turno.estado.finalizado) {
        await _almacen.borrar();
        return null;
      }
      return turno;
    } on ErrorTurno catch (e) {
      if (e.codigo == 'TURNO_NO_ENCONTRADO') await _almacen.borrar();
      return null;
    }
  }
}

class CancelarTurno {
  CancelarTurno(this._servicio, this._almacen);

  final ServicioTurnos _servicio;
  final AlmacenTurno _almacen;

  Future<Turno> call(String token) async {
    final turno = await _servicio.cancelarTurno(token);
    await _almacen.borrar();
    return turno;
  }
}

/// Olvidar el turno terminado para poder tomar otro.
class OlvidarTurno {
  OlvidarTurno(this._almacen);

  final AlmacenTurno _almacen;

  Future<void> call() => _almacen.borrar();
}

/// Seguimiento en vivo: vuelve a consultar el turno con cada cambio del local (canal en vivo) y cada 15 s por si
/// la conexión se corta. Avisa con una notificación local cuando el turno está cerca y cuando lo llaman.
class SeguirTurno {
  SeguirTurno(this._servicio, this._notificador, {this.respaldo = const Duration(seconds: 15)});

  final ServicioTurnos _servicio;
  final Notificador _notificador;
  final Duration respaldo;

  /// Cada cambio del local (turno emitido, llamado…): lo usa el panel del personal para refrescarse al instante.
  Stream<void> cambiosDe(String slug) => _servicio.cambiosDelLocal(slug);

  Stream<Turno> call(Turno inicial) {
    late StreamController<Turno> salida;
    StreamSubscription<void>? cambios;
    Timer? temporizador;
    Timer? espera;
    var avisoCerca = inicial.estaCerca;
    var avisoLlamado = inicial.estado == EstadoTurno.llamado;
    var consultando = false;

    Future<void> refrescar() async {
      if (consultando || salida.isClosed) return;
      consultando = true;
      try {
        final turno = await _servicio.consultarTurno(inicial.token);
        if (salida.isClosed) return;
        salida.add(turno);
        if (turno.estado == EstadoTurno.llamado && !avisoLlamado) {
          avisoLlamado = true;
          await _notificador.avisar('¡Es tu turno ${turno.codigo}!',
              turno.ventanilla == null ? 'Acércate a la ventanilla.' : 'Acércate a ${turno.ventanilla}.');
        } else if (turno.estaCerca && turno.estado.enEspera && !avisoCerca) {
          avisoCerca = true;
          await _notificador.avisar('Tu turno ${turno.codigo} está cerca',
              turno.personasDelante == 0 ? '¡Eres el siguiente!' : 'Faltan ${turno.personasDelante} personas. Ve acercándote.');
        }
        if (turno.estado.finalizado) await salida.close();
      } on Object catch (e) {
        // Sin red: se reintenta en el siguiente cambio o en el respaldo periódico
        if (!salida.isClosed) salida.addError(e);
      } finally {
        consultando = false;
      }
    }

    /// Varios eventos seguidos (cola actualizada + turno llamado) generan una sola consulta.
    void programar() {
      espera?.cancel();
      espera = Timer(const Duration(milliseconds: 400), refrescar);
    }

    salida = StreamController<Turno>(
      onListen: () {
        salida.add(inicial);
        cambios = _servicio.cambiosDelLocal(inicial.localSlug).listen((_) => programar(), onError: (_) {});
        temporizador = Timer.periodic(respaldo, (_) => refrescar());
      },
      onCancel: () async {
        temporizador?.cancel();
        espera?.cancel();
        await cambios?.cancel();
      },
    );
    return salida.stream;
  }
}

/// Crear la cuenta con correo y contraseña (mismas reglas que el servidor, para avisar antes de enviar).
class RegistrarCuenta {
  RegistrarCuenta(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  static final _correo = RegExp(r'^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$');

  /// Problema de la contraseña, o nulo si sirve.
  static String? problemaDeClave(String clave) {
    if (clave.length < 8) return 'Usa al menos 8 caracteres.';
    if (clave.length > 72) return 'Usa como máximo 72 caracteres.';
    if (!RegExp(r'\p{L}', unicode: true).hasMatch(clave) || !RegExp(r'\d').hasMatch(clave)) return 'Combina letras y números.';
    return null;
  }

  static bool correoValido(String correo) => correo.trim().length <= 120 && _correo.hasMatch(correo.trim());

  Future<Sesion> call({required String correo, required String clave, required String nombre, required bool acepta}) async {
    final limpio = nombre.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (limpio.length < 2) throw const ErrorTurno('NOMBRE_INVALIDO', 'Escribe tu nombre.');
    if (!correoValido(correo)) throw const ErrorTurno('CORREO_INVALIDO', 'Escribe un correo válido (ej. nombre@gmail.com).');
    final problema = problemaDeClave(clave);
    if (problema != null) throw ErrorTurno('CLAVE_DEBIL', 'Contraseña: $problema');
    if (!acepta) throw const ErrorTurno('CONSENTIMIENTO_REQUERIDO', 'Acepta el uso de tus datos para crear la cuenta.');
    final sesion = await _servicio.registrar(correo: correo.trim(), clave: clave, nombre: limpio, dispositivo: await _cuenta.dispositivo());
    await _cuenta.guardarSesion(sesion);
    return sesion;
  }
}

/// Ingresar con correo y contraseña.
class IngresarConCorreo {
  IngresarConCorreo(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  Future<Sesion> call({required String correo, required String clave}) async {
    if (correo.trim().isEmpty || clave.isEmpty) throw const ErrorTurno('DATOS_INCOMPLETOS', 'Escribe tu correo y tu contraseña.');
    final sesion = await _servicio.ingresar(correo: correo.trim(), clave: clave, dispositivo: await _cuenta.dispositivo());
    await _cuenta.guardarSesion(sesion);
    return sesion;
  }
}

/// Perfil de la cuenta con su estado antifraude. Si la sesión venció, la borra del teléfono.
class VerPerfil {
  VerPerfil(this._servicio, this._cuenta);

  final ServicioTurnos _servicio;
  final AlmacenCuenta _cuenta;

  Future<Perfil> call() async {
    final sesion = await _cuenta.leerSesion();
    if (sesion == null) throw const ErrorTurno('APP_SESION_INVALIDA', 'Ingresa a tu cuenta para ver tu perfil.');
    try {
      return await _servicio.perfil(sesion.token, await _cuenta.dispositivo());
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') await _cuenta.borrarSesion();
      rethrow;
    }
  }
}

/// Citas del cliente: reservar, ver las suyas (y sus sanciones), cancelar y hacer check-in al llegar al local.
/// Todo exige la cuenta; si la sesión venció, la borra del teléfono.
class CitasDelCliente {
  CitasDelCliente(this._servicio, this._cuenta);

  final ServicioCitas _servicio;
  final AlmacenCuenta _cuenta;

  Future<List<LocalConCitas>> locales() => _servicio.localesConCitas();

  Future<OfertaCitas> oferta(String slug) => _servicio.ofertaCitas(slug);

  Future<List<DiaCita>> dias(String slug, int servicioId) => _servicio.diasCita(slug, servicioId);

  Future<List<HorarioCita>> horarios(String slug, int servicioId, String fecha) => _servicio.horariosCita(slug, servicioId, fecha);

  Future<MisCitas> mias() => _conSesion(_servicio.misCitas);

  Future<void> reservar({required String slug, required int servicioId, required int horarioId}) =>
      _conSesion((s) => _servicio.reservarCita(s, slug: slug, servicioId: servicioId, horarioId: horarioId));

  Future<void> cancelar(String token) => _conSesion((s) => _servicio.cancelarCita(s, token));

  /// Check-in con el QR «App» escaneado en la TV: tiene que ser del mismo local de la cita y traer la marca de presencia.
  Future<LlegadaCita> llegue(Cita cita, String contenidoQr) {
    final qr = leerQr(contenidoQr);
    if (qr == null || qr.presencia == null) {
      return Future.error(const ErrorTurno('QR_INVALIDO', 'Escanea el QR azul «App» que aparece en la pantalla del local.'));
    }
    if (qr.slug != cita.localSlug) {
      return Future.error(ErrorTurno('QR_OTRO_LOCAL', 'Ese QR es de otro local. Tu cita es en ${cita.local}.'));
    }
    return _conSesion((s) => _servicio.checkinCita(s, cita.token, qr.presencia!));
  }

  Future<T> _conSesion<T>(Future<T> Function(String sesion) hacer) async {
    final sesion = await _cuenta.leerSesion();
    if (sesion == null) throw const ErrorTurno('APP_SESION_INVALIDA', 'Ingresa a tu cuenta para reservar citas.');
    try {
      return await hacer(sesion.token);
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') await _cuenta.borrarSesion();
      rethrow;
    }
  }
}

/// El negocio desde el celular (personal: admin u operador). Si el token venció, borra la sesión del teléfono y lanza
/// `NO_AUTENTICADO` para volver a la pantalla de ingreso.
class PersonalDelNegocio {
  PersonalDelNegocio(this._servicio, this._almacen);

  final ServicioPersonal _servicio;
  final AlmacenPersonal _almacen;

  Future<SesionPersonal?> sesion() => _almacen.leerPersonal();

  Future<SesionPersonal> ingresar(String correo, String clave) async {
    if (correo.trim().isEmpty || clave.isEmpty) throw const ErrorTurno('VALIDACION', 'Escribe tu correo y tu contraseña.');
    final s = await _servicio.ingresarPersonal(correo, clave);
    await _almacen.guardarPersonal(s);
    return s;
  }

  Future<void> salir() => _almacen.borrarPersonal();

  Future<PanelPersonal> panel() => _con(_servicio.panel);

  Future<TurnoPersonal?> llamarSiguiente(int ventanillaId) => _con((t) => _servicio.llamarSiguiente(t, ventanillaId));

  Future<void> atendido(int turnoId) => _con((t) => _servicio.marcarTurno(t, turnoId, 'ATENDIDO'));

  Future<void> noSePresento(int turnoId) => _con((t) => _servicio.marcarTurno(t, turnoId, 'NO_SE_PRESENTO'));

  Future<void> volverALlamar(int turnoId) => _con((t) => _servicio.marcarTurno(t, turnoId, 'LLAMADO'));

  /// Con [telefono] el cliente recibe su turno y el llamado por WhatsApp (necesita su permiso: [consentimiento]).
  /// [recepcion]: lo emite el kiosco (cualquier cola del local) en vez de un operador en sus colas.
  Future<TicketEmitido> ticket({required int colaId, String? nombre, String? telefono, bool consentimiento = false, bool recepcion = false}) {
    final n = nombre?.trim();
    final tel = telefono?.replaceAll(RegExp(r'[\s-]'), '');
    if (tel != null && tel.isNotEmpty && !consentimiento) {
      return Future.error(const ErrorTurno('CONSENTIMIENTO_REQUERIDO', 'Marca que el cliente acepta los avisos por WhatsApp.'));
    }
    final nombreLimpio = n == null || n.isEmpty ? null : n;
    final telLimpio = tel == null || tel.isEmpty ? null : tel;
    return _con((t) => recepcion
        ? _servicio.emitirTicketKiosco(t, colaId: colaId, nombre: nombreLimpio, telefono: telLimpio, consentimiento: consentimiento)
        : _servicio.emitirTicket(t, colaId: colaId, nombre: nombreLimpio, telefono: telLimpio, consentimiento: consentimiento));
  }

  Future<PanelKiosco> panelKiosco() => _con(_servicio.panelKiosco);

  Future<String> transferir(int turnoId, int aColaId) => _con((t) => _servicio.transferir(t, turnoId, aColaId));

  Future<List<ColaNegocio>> colas() => _con(_servicio.colas);

  Future<void> crearCola({required String prefijo, required String nombre}) =>
      _con((t) => _servicio.crearCola(t, prefijo: prefijo.trim().toUpperCase(), nombre: nombre.trim()));

  Future<void> activarCola(int id, bool activa) => _con((t) => _servicio.activarCola(t, id, activa));

  Future<void> eliminarCola(int id) => _con((t) => _servicio.eliminarCola(t, id));

  Future<List<VentanillaNegocio>> ventanillas() => _con(_servicio.ventanillas);

  Future<void> crearVentanilla({required String nombre, required int colaId}) =>
      _con((t) => _servicio.crearVentanilla(t, nombre: nombre.trim(), colaId: colaId));

  Future<void> editarVentanilla(int id, {String? nombre, bool? activa}) =>
      _con((t) => _servicio.editarVentanilla(t, id, nombre: nombre?.trim(), activa: activa));

  Future<WhatsAppNegocio> whatsapp() => _con(_servicio.whatsapp);

  Future<WhatsAppNegocio> guardarNumero(String telefono) => _con((t) => _servicio.accionWhatsapp(t, 'numero', telefono: telefono));

  Future<WhatsAppNegocio> pedirCodigo() => _con((t) => _servicio.accionWhatsapp(t, 'codigo'));

  Future<WhatsAppNegocio> probarWhatsapp(String telefono) => _con((t) => _servicio.accionWhatsapp(t, 'prueba', telefono: telefono));

  Future<WhatsAppNegocio> desvincularWhatsapp() => _con((t) => _servicio.accionWhatsapp(t, 'desvincular'));

  Future<T> _con<T>(Future<T> Function(String token) hacer) async {
    final s = await _almacen.leerPersonal();
    if (s == null) throw const ErrorTurno('NO_AUTENTICADO', 'Ingresa con tu cuenta del negocio.');
    try {
      return await hacer(s.token);
    } on ErrorTurno catch (e) {
      if (e.codigo == 'NO_AUTENTICADO') {
        await _almacen.borrarPersonal();
        throw const ErrorTurno('NO_AUTENTICADO', 'Tu sesión venció. Vuelve a ingresar.');
      }
      rethrow;
    }
  }
}
