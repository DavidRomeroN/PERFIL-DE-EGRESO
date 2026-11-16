import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:turnoya_movil/aplicacion/casos_de_uso.dart';
import 'package:turnoya_movil/dominio/codigo_qr.dart';
import 'package:turnoya_movil/dominio/citas.dart';
import 'package:turnoya_movil/dominio/modelos.dart';
import 'package:turnoya_movil/dominio/personal.dart';
import 'package:turnoya_movil/dominio/puertos.dart';
import 'package:turnoya_movil/dominio/url_servidor.dart';

Turno turno({EstadoTurno estado = EstadoTurno.emitido, int delante = 5, String? ventanilla}) => Turno(
      token: 'tok',
      codigo: 'A-001',
      estado: estado,
      canal: 'APP',
      personasDelante: delante,
      tiempoEstimadoSeg: delante * 120,
      cola: 'Caja',
      ventanilla: ventanilla,
      localSlug: 'policlinico',
      localNombre: 'Policlínico',
      colorPrimario: '#2563eb',
      avisarFaltando: 2,
      urlSeguimiento: 'http://x/t/tok',
    );

/// Servidor falso: devuelve los turnos en orden y deja disparar cambios del local a mano.
class ServicioFalso implements ServicioTurnos {
  ServicioFalso(this.respuestas);

  final List<Turno> respuestas;
  final cambios = StreamController<void>.broadcast();
  int? colaPedida;
  String? presenciaEnviada;
  String? dispositivoEnviado;
  String? sesionEnviada;
  ErrorTurno? errorAlTomar;
  ErrorTurno? errorHistorial;
  String? consultado;
  String? categoriaEnviada;

  @override
  Future<List<FranjaEspera>> mejoresHoras(int colaId) async => const [];

  @override
  Future<Turno> consultarTurno(String token) async {
    consultado = token;
    return respuestas.length > 1 ? respuestas.removeAt(0) : respuestas.first;
  }

  @override
  Stream<void> cambiosDelLocal(String slug) => cambios.stream;

  @override
  Future<Turno> tomarTurno(
      {required int colaId, String? nombre, String? categoria, String? presencia, required String dispositivo, String? sesion}) async {
    colaPedida = colaId;
    categoriaEnviada = categoria;
    presenciaEnviada = presencia;
    dispositivoEnviado = dispositivo;
    sesionEnviada = sesion;
    if (errorAlTomar != null) throw errorAlTomar!;
    return respuestas.first;
  }

  @override
  Future<void> pedirCodigo({required String slug, required String telefono}) async {}

  @override
  Future<Sesion> abrirSesion({required String telefono, required String codigo, String? nombre, required String dispositivo}) async =>
      Sesion(token: 'ses-$codigo', cuenta: Cuenta(telefono: '***321', nombre: nombre));

  String? correoRegistrado;
  ErrorTurno? errorPerfil;

  @override
  Future<Sesion> registrar({required String correo, required String clave, required String nombre, required String dispositivo}) async {
    correoRegistrado = correo;
    return Sesion(token: 'ses-reg', cuenta: Cuenta(correo: correo, nombre: nombre));
  }

  @override
  Future<Sesion> ingresar({required String correo, required String clave, required String dispositivo}) async {
    if (clave != 'segura123') throw const ErrorTurno('CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');
    return Sesion(token: 'ses-ing', cuenta: Cuenta(correo: correo));
  }

  @override
  Future<Perfil> perfil(String sesion, String dispositivo) async {
    if (errorPerfil != null) throw errorPerfil!;
    return const Perfil(cuenta: Cuenta(correo: 'a@b.pe'), faltas: [], maxFaltas: 3, diasFaltas: 7, activos: 0, maxActivos: 2);
  }

  @override
  Future<void> cerrarSesion(String sesion) async => throw const ErrorTurno('SIN_RED', 'sin red');

  @override
  Future<List<TurnoPasado>> historial(String sesion) async {
    if (errorHistorial != null) throw errorHistorial!;
    return const [];
  }

  @override
  Future<Turno> cancelarTurno(String token) async => turno(estado: EstadoTurno.cancelado);

  @override
  Future<Local> obtenerLocal(String slug) async =>
      Local(slug: slug, nombre: 'Policlínico', colorPrimario: '#000000', abierto: true, avisarFaltando: 2, colas: const []);
}

class NotificadorFalso implements Notificador {
  final avisos = <String>[];

  @override
  Future<void> avisar(String titulo, String cuerpo) async => avisos.add(titulo);

  @override
  Future<void> preparar() async {}
}

class AlmacenFalso implements AlmacenTurno {
  String? token;

  @override
  Future<void> borrar() async => token = null;

  @override
  Future<void> guardar(String t) async => token = t;

  @override
  Future<String?> leer() async => token;
}

class CuentaFalsa implements AlmacenCuenta {
  Sesion? sesion;

  @override
  Future<String> dispositivo() async => 'disp-0123456789abcdef';

  @override
  Future<Sesion?> leerSesion() async => sesion;

  @override
  Future<void> guardarSesion(Sesion s) async => sesion = s;

  @override
  Future<void> borrarSesion() async => sesion = null;
}

const localConQr = Local(
    slug: 'policlinico',
    nombre: 'Policlínico',
    colorPrimario: '#000000',
    abierto: true,
    avisarFaltando: 2,
    colas: [],
    presencia: 'k3x.firma',
    categorias: [Categoria(codigo: 'ADULTO_MAYOR', nombre: 'Adulto mayor', documento: 'DNI')]);

class LocalesEnMemoria implements AlmacenLocales {
  List<LocalGuardado> lista = [];

  @override
  Future<List<LocalGuardado>> leer() async => lista;

  @override
  Future<void> guardar(List<LocalGuardado> locales) async => lista = locales;
}

Local localLlamado(String slug) =>
    Local(slug: slug, nombre: 'Local $slug', colorPrimario: '#000000', abierto: true, avisarFaltando: 2, colas: const []);

void main() {
  group('slugDesdeQr', () {
    test('lee el QR de la app de la TV', () => expect(slugDesdeQr('https://turnoya.pe/l/policlinico-sanjuan/app'), 'policlinico-sanjuan'));
    test('lee el QR web', () => expect(slugDesdeQr('http://localhost:8080/l/botica?cola=1'), 'botica'));
    test('lee el esquema de la app', () => expect(slugDesdeQr('turnoya://l/botica'), 'botica'));
    test('acepta el código escrito a mano', () => expect(slugDesdeQr(' Botica-Central '), 'botica-central'));
    test('rechaza otros QR', () => expect(slugDesdeQr('https://otra.com/pagina con espacios'), isNull));
  });

  test('un turno está cerca cuando faltan avisarFaltando personas o lo llaman', () {
    expect(turno(delante: 3).estaCerca, isFalse);
    expect(turno(delante: 2).estaCerca, isTrue);
    expect(turno(estado: EstadoTurno.llamado, delante: 0).estaCerca, isTrue);
    expect(turno(estado: EstadoTurno.cancelado).estado.finalizado, isTrue);
  });

  group('leerQr', () {
    test('trae la marca de presencia del QR de la TV', () {
      final d = leerQr('https://turnoya.pe/l/policlinico/app?p=k3x.AbC_d-9');
      expect(d?.slug, 'policlinico');
      expect(d?.presencia, 'k3x.AbC_d-9');
    });
    test('la trae también en el esquema de la app', () => expect(leerQr('turnoya://l/botica?p=k3x.firma')?.presencia, 'k3x.firma'));
    test('el código escrito a mano no tiene marca', () => expect(leerQr('botica')?.presencia, isNull));
    test('ignora una marca con caracteres extraños', () => expect(leerQr('https://x.pe/l/botica/app?p=<script>')?.presencia, isNull));
  });

  group('validarUrlServidor', () {
    test('producción exige https', () {
      expect(() => validarUrlServidor('http://turnoya.pe', produccion: true), throwsArgumentError);
      expect(() => validarUrlServidor('http://10.0.2.2:8080', produccion: true), throwsArgumentError);
      expect(validarUrlServidor('https://turnoya.pe', produccion: true), 'https://turnoya.pe');
    });
    test('desarrollo permite http solo hacia la PC', () {
      expect(validarUrlServidor('http://10.0.2.2:8080', produccion: false), 'http://10.0.2.2:8080');
      expect(validarUrlServidor('http://192.168.1.20:8080', produccion: false), 'http://192.168.1.20:8080');
      expect(() => validarUrlServidor('http://turnoya.pe', produccion: false), throwsArgumentError);
    });
  });

  test('abrir el local desde el QR guarda la marca de presencia', () async {
    final local = await AbrirLocal(ServicioFalso([turno()])).desdeQr('https://turnoya.pe/l/policlinico/app?p=k3x.firma');
    expect(local.presencia, 'k3x.firma');
  });

  test('tomar turno envía marca, dispositivo y sesión, y lo guarda para seguirlo', () async {
    final servicio = ServicioFalso([turno()]);
    final almacen = AlmacenFalso();
    final cuenta = CuentaFalsa()..sesion = const Sesion(token: 'ses-1', cuenta: Cuenta(telefono: '***321'));
    await TomarTurno(servicio, almacen, cuenta)(local: localConQr, colaId: 7, nombre: '  ');
    expect(servicio.colaPedida, 7);
    expect(servicio.presenciaEnviada, 'k3x.firma');
    expect(servicio.dispositivoEnviado, 'disp-0123456789abcdef');
    expect(servicio.sesionEnviada, 'ses-1');
    expect(almacen.token, 'tok');
  });

  test('sin marca de presencia no se toma turno', () async {
    final servicio = ServicioFalso([turno()]);
    final sinQr = Local(slug: 'x', nombre: 'X', colorPrimario: '#000000', abierto: true, avisarFaltando: 2, colas: const []);
    await expectLater(TomarTurno(servicio, AlmacenFalso(), CuentaFalsa())(local: sinQr, colaId: 1),
        throwsA(isA<ErrorTurno>().having((e) => e.codigo, 'codigo', 'APP_QR_VENCIDO')));
    expect(servicio.colaPedida, isNull);
  });

  test('si el teléfono ya tenía turno activo, se retoma ese turno', () async {
    final servicio = ServicioFalso([turno()])..errorAlTomar = const ErrorTurno('TURNO_DUPLICADO', 'ya tienes', {'token': 'previo', 'codigo': 'A-001'});
    final almacen = AlmacenFalso();
    final t = await TomarTurno(servicio, almacen, CuentaFalsa())(local: localConQr, colaId: 1);
    expect(servicio.consultado, 'previo');
    expect(t.codigo, 'A-001');
    expect(almacen.token, 'tok');
  });

  test('ingresar guarda la sesión y cerrarla la borra aunque no haya red', () async {
    final servicio = ServicioFalso([turno()]);
    final cuenta = CuentaFalsa();
    await IniciarSesion(servicio, cuenta)(telefono: '987 654 321', codigo: ' 123456 ', nombre: 'Ana');
    expect(cuenta.sesion?.token, 'ses-123456');
    expect((await CuentaActual(cuenta)())?.nombre, 'Ana');
    await CerrarSesion(servicio, cuenta)();
    expect(cuenta.sesion, isNull);
  });

  test('pedir código rechaza un celular mal escrito', () {
    expect(() => PedirCodigo(ServicioFalso([turno()]))(slug: 'x', telefono: '12ab'), throwsA(isA<ErrorTurno>()));
  });

  test('una sesión vencida en el historial se borra del teléfono', () async {
    final servicio = ServicioFalso([turno()])..errorHistorial = const ErrorTurno('APP_SESION_INVALIDA', 'vencida');
    final cuenta = CuentaFalsa()..sesion = const Sesion(token: 'viejo', cuenta: Cuenta(telefono: '***321'));
    await expectLater(VerHistorial(servicio, cuenta)(), throwsA(isA<ErrorTurno>()));
    expect(cuenta.sesion, isNull);
  });

  test('el seguimiento refresca con cada cambio del local y avisa una vez cerca y otra al ser llamado', () async {
    final servicio = ServicioFalso([turno(delante: 2), turno(delante: 1), turno(estado: EstadoTurno.llamado, delante: 0, ventanilla: 'V1')]);
    final notificador = NotificadorFalso();
    final vistos = <Turno>[];
    final sub = SeguirTurno(servicio, notificador, respaldo: const Duration(hours: 1))(turno()).listen(vistos.add);

    for (var i = 0; i < 3; i++) {
      servicio.cambios.add(null);
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    await sub.cancel();

    expect(vistos.map((t) => t.personasDelante), [5, 2, 1, 0]);
    expect(notificador.avisos, ['Tu turno A-001 está cerca', '¡Es tu turno A-001!']);
  });

  group('atención preferencial', () {
    test('envía la categoría que el local ofrece', () async {
      final servicio = ServicioFalso([turno()]);
      await TomarTurno(servicio, AlmacenFalso(), CuentaFalsa())(local: localConQr, colaId: 1, categoria: 'ADULTO_MAYOR');
      expect(servicio.categoriaEnviada, 'ADULTO_MAYOR');
    });
    test('ignora una categoría que el local no tiene', () async {
      final servicio = ServicioFalso([turno()]);
      await TomarTurno(servicio, AlmacenFalso(), CuentaFalsa())(local: localConQr, colaId: 1, categoria: 'EMERGENCIA');
      expect(servicio.categoriaEnviada, isNull);
    });
    test('el documento se muestra legible', () {
      expect(const Categoria(codigo: 'G', nombre: 'Gestante', documento: 'CARNE_GESTANTE').documentoLegible, 'carné de gestante');
      expect(const Categoria(codigo: 'X', nombre: 'X', documento: 'NINGUNO').documentoLegible, isNull);
    });
  });

  group('mis locales', () {
    test('abrir un local lo recuerda; favoritos primero y luego el más reciente', () async {
      var hora = DateTime(2026, 1, 1, 10);
      final almacen = LocalesEnMemoria();
      final mis = MisLocales(almacen, reloj: () => hora);
      await AbrirLocal(ServicioFalso([turno()]), misLocales: mis).desdeQr('https://turnoya.pe/l/botica/app?p=k3x.firma');
      hora = hora.add(const Duration(hours: 1));
      await mis.recordar(localLlamado('panaderia'));
      await mis.alternarFavorito('botica');
      expect((await mis()).map((l) => l.slug), ['botica', 'panaderia']);
      await mis.alternarFavorito('botica');
      expect((await mis()).map((l) => l.slug), ['panaderia', 'botica']);
    });

    test('volver a un local actualiza la visita sin duplicarlo', () async {
      var hora = DateTime(2026, 1, 1);
      final almacen = LocalesEnMemoria();
      final mis = MisLocales(almacen, reloj: () => hora);
      await mis.recordar(localLlamado('a'));
      hora = DateTime(2026, 1, 2);
      await mis.recordar(localLlamado('a'));
      expect(almacen.lista, hasLength(1));
      expect(almacen.lista.single.ultimaVisita, DateTime(2026, 1, 2));
    });

    test('solo guarda los recientes más nuevos, pero nunca pierde un favorito', () async {
      var minuto = 0;
      final almacen = LocalesEnMemoria();
      final mis = MisLocales(almacen, reloj: () => DateTime(2026).add(Duration(minutes: minuto++)));
      await mis.recordar(localLlamado('favorito'));
      await mis.alternarFavorito('favorito');
      for (var i = 0; i < MisLocales.maximoRecientes + 5; i++) {
        await mis.recordar(localLlamado('l$i'));
      }
      final slugs = (await mis()).map((l) => l.slug).toList();
      expect(slugs.first, 'favorito');
      expect(slugs, hasLength(MisLocales.maximoRecientes + 1));
      expect(slugs, isNot(contains('l0')));
    });

    test('se guarda y se lee como JSON', () {
      final l = LocalGuardado(slug: 's', nombre: 'S', colorPrimario: '#111111', ultimaVisita: DateTime(2026, 3, 4), favorito: true);
      final copia = LocalGuardado.desdeJson(l.aJson())!;
      expect([copia.slug, copia.nombre, copia.colorPrimario, copia.favorito], ['s', 'S', '#111111', true]);
      expect(LocalGuardado.desdeJson({'slug': 1}), isNull);
    });
  });

  group('cuenta con correo', () {
    test('valida nombre, correo, contraseña y consentimiento antes de enviar', () async {
      final servicio = ServicioFalso([turno()]);
      final registrar = RegistrarCuenta(servicio, CuentaFalsa());
      Future<String> codigo(Future<Object?> f) => f.then((_) => 'OK', onError: (Object e) => (e as ErrorTurno).codigo);
      expect(await codigo(registrar(correo: 'ana@gmail.com', clave: 'segura123', nombre: ' ', acepta: true)), 'NOMBRE_INVALIDO');
      expect(await codigo(registrar(correo: 'ana@gmail', clave: 'segura123', nombre: 'Ana', acepta: true)), 'CORREO_INVALIDO');
      expect(await codigo(registrar(correo: 'ana@gmail.com', clave: 'solotexto', nombre: 'Ana', acepta: true)), 'CLAVE_DEBIL');
      expect(await codigo(registrar(correo: 'ana@gmail.com', clave: 'segura123', nombre: 'Ana', acepta: false)), 'CONSENTIMIENTO_REQUERIDO');
      expect(servicio.correoRegistrado, isNull);
    });

    test('registrarse guarda la sesión con el correo', () async {
      final servicio = ServicioFalso([turno()]);
      final cuenta = CuentaFalsa();
      await RegistrarCuenta(servicio, cuenta)(correo: ' ana@gmail.com ', clave: 'segura123', nombre: '  Ana   Quispe ', acepta: true);
      expect(servicio.correoRegistrado, 'ana@gmail.com');
      expect(cuenta.sesion?.cuenta.correo, 'ana@gmail.com');
      expect(cuenta.sesion?.cuenta.nombre, 'Ana Quispe');
    });

    test('ingresar con contraseña mala no guarda nada', () async {
      final cuenta = CuentaFalsa();
      await expectLater(IngresarConCorreo(ServicioFalso([turno()]), cuenta)(correo: 'a@b.pe', clave: 'mala'), throwsA(isA<ErrorTurno>()));
      expect(cuenta.sesion, isNull);
      await IngresarConCorreo(ServicioFalso([turno()]), cuenta)(correo: 'a@b.pe', clave: 'segura123');
      expect(cuenta.sesion?.token, 'ses-ing');
    });

    test('el perfil con sesión vencida borra la sesión', () async {
      final servicio = ServicioFalso([turno()])..errorPerfil = const ErrorTurno('APP_SESION_INVALIDA', 'vencida');
      final cuenta = CuentaFalsa()..sesion = const Sesion(token: 't', cuenta: Cuenta(correo: 'a@b.pe'));
      await expectLater(VerPerfil(servicio, cuenta)(), throwsA(isA<ErrorTurno>()));
      expect(cuenta.sesion, isNull);
    });

    test('estado de faltas del perfil', () {
      Falta falta() => Falta(fecha: DateTime(2026), codigo: 'A-1', cola: 'Caja', local: 'L');
      final dos = Perfil(cuenta: const Cuenta(), faltas: [falta(), falta()], maxFaltas: 3, diasFaltas: 7, activos: 0, maxActivos: 2);
      expect(dos.bloqueado, isFalse);
      expect(dos.faltasRestantes, 1);
      final bloqueado = Perfil(
          cuenta: const Cuenta(),
          faltas: [falta(), falta(), falta()],
          maxFaltas: 3,
          diasFaltas: 7,
          bloqueadoHasta: DateTime.now().add(const Duration(days: 2)),
          activos: 0,
          maxActivos: 2);
      expect(bloqueado.bloqueado, isTrue);
      expect(bloqueado.faltasRestantes, 0);
    });

    test('iniciales e identificador de la cuenta', () {
      expect(const Cuenta(nombre: 'ana quispe', correo: 'a@b.pe').iniciales, 'AQ');
      expect(const Cuenta(correo: 'luis@b.pe').iniciales, 'L');
      expect(const Cuenta(telefono: '+51 9** *** 321').identificador, '+51 9** *** 321');
    });
  });
}

/// Citas en memoria: una cita activa en «centro» y una sanción vigente.
class CitasFalsas implements ServicioCitas {
  String? presenciaRecibida;
  final reservadas = <int>[];

  @override
  Future<List<LocalConCitas>> localesConCitas() async => const [
        LocalConCitas(slug: 'centro', nombre: 'Centro', rubro: 'Salud', ciudad: 'Juliaca', servicios: 1),
        LocalConCitas(slug: 'dental-sonrisa', nombre: 'Dental Sonrisa', rubro: 'Salud', ciudad: 'Juliaca', servicios: 2),
      ];

  @override
  Future<OfertaCitas> ofertaCitas(String slug) async => const OfertaCitas(
      disponible: true, local: 'Centro', color: '#2563eb', servicios: [ServicioCita(id: 1, nombre: 'Consulta', duracionMin: 15, diasMax: 7)]);

  @override
  Future<List<DiaCita>> diasCita(String slug, int servicioId) async => const [DiaCita(fecha: '2026-11-16', abierto: true, libres: 3)];

  @override
  Future<List<HorarioCita>> horariosCita(String slug, int servicioId, String fecha) async =>
      const [HorarioCita(id: 9, hora: '09:00', restantes: 1, disponible: true)];

  @override
  Future<MisCitas> misCitas(String sesion) async => const MisCitas([
        Cita(
            token: 'cita-1',
            estado: EstadoCita.reservada,
            inicio: null,
            inicioTexto: 'lunes, 16 de noviembre, 09:00',
            localSlug: 'centro',
            local: 'Centro',
            servicio: 'Consulta',
            codigo: 'ABC123',
            activa: true),
      ], [
        Sancion(local: 'Otro local', hastaTexto: '17/11 a las 10:00', motivo: 'No se presentó a su cita: sin citas por 1 día'),
      ]);

  @override
  Future<void> reservarCita(String sesion, {required String slug, required int servicioId, required int horarioId}) async =>
      reservadas.add(horarioId);

  @override
  Future<void> cancelarCita(String sesion, String token) async {}

  @override
  Future<LlegadaCita> checkinCita(String sesion, String token, String presencia) async {
    presenciaRecibida = presencia;
    return const LlegadaCita(turnoToken: 'turno-cita', codigo: 'C-001', tarde: false);
  }
}

class PersonalEnMemoria implements AlmacenPersonal {
  SesionPersonal? sesion;

  @override
  Future<SesionPersonal?> leerPersonal() async => sesion;

  @override
  Future<void> guardarPersonal(SesionPersonal s) async => sesion = s;

  @override
  Future<void> borrarPersonal() async => sesion = null;
}

/// API del personal en memoria: un consultorio con una ventanilla (o dos con [dosVentanillas]).
class PersonalFalso implements ServicioPersonal {
  PersonalFalso({this.dosVentanillas = false, this.rol = 'OPERADOR'});

  final bool dosVentanillas;
  final String rol;
  final llamadas = <int>[];
  final marcados = <String>[];
  Map<String, Object?>? ticket;
  var vencida = false;

  @override
  Future<SesionPersonal> ingresarPersonal(String correo, String clave) async {
    if (clave != 'operador123') throw const ErrorTurno('CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
    return SesionPersonal(token: 'jwt.de.prueba', nombre: 'Dra. Ríos', rol: rol, local: 'Dental Sonrisa');
  }

  @override
  Future<PanelPersonal> panel(String token) async {
    if (vencida) throw const ErrorTurno('NO_AUTENTICADO', 'Inicia sesión para continuar');
    return PanelPersonal(
      usuario: 'Dra. Ríos',
      esAdmin: rol == 'ADMIN_LOCAL',
      local: 'Dental Sonrisa',
      slug: 'dental-sonrisa',
      whatsapp: true,
      ventanillas: [
        const VentanillaPersonal(
            id: 1, nombre: 'Consultorio 1', colaId: 10, cola: 'Dra. Ríos', prefijo: 'R', enEspera: 2,
            siguientes: [TurnoPersonal(id: 5, codigo: 'R-002', nombre: 'Ana', canal: 'TICKET')]),
        if (dosVentanillas)
          const VentanillaPersonal(id: 2, nombre: 'Consultorio 2', colaId: 11, cola: 'Dr. Paredes', prefijo: 'P', enEspera: 0),
      ],
      colasTicket: [
        const ColaTicket(id: 10, nombre: 'Dra. Ríos', prefijo: 'R'),
        if (dosVentanillas) const ColaTicket(id: 11, nombre: 'Dr. Paredes', prefijo: 'P'),
      ],
    );
  }

  @override
  Future<TurnoPersonal?> llamarSiguiente(String token, int ventanillaId) async {
    llamadas.add(ventanillaId);
    return const TurnoPersonal(id: 5, codigo: 'R-002', canal: 'TICKET');
  }

  @override
  Future<void> marcarTurno(String token, int turnoId, String estado) async => marcados.add('$turnoId:$estado');

  @override
  Future<TicketEmitido> emitirTicket(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false}) async {
    ticket = {'colaId': colaId, 'nombre': nombre, 'telefono': telefono, 'consentimiento': consentimiento};
    return const TicketEmitido(codigo: 'R-003', token: 'tk');
  }

  @override
  Future<PanelKiosco> panelKiosco(String token) async => PanelKiosco(
        usuario: 'Recepción',
        local: 'Dental Sonrisa',
        slug: 'dental-sonrisa',
        whatsapp: true,
        puedeTransferir: true,
        colas: const [
          ColaKiosco(id: 10, nombre: 'Dra. Ríos', prefijo: 'R', enEspera: 1, tiempoEstimadoSeg: 300),
          ColaKiosco(id: 11, nombre: 'Dr. Paredes', prefijo: 'P', enEspera: 0),
        ],
        espera: [
          EsperaKiosco(id: 5, codigo: 'R-002', nombre: 'Ana', canal: 'TICKET', emitidoAt: DateTime.now(), colaId: 10, cola: 'Dra. Ríos', prefijo: 'R'),
        ],
      );

  @override
  Future<TicketEmitido> emitirTicketKiosco(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false}) async {
    ticket = {'recepcion': true, 'colaId': colaId, 'nombre': nombre, 'telefono': telefono, 'consentimiento': consentimiento};
    return const TicketEmitido(codigo: 'R-003', token: 'tk');
  }

  final transferencias = <String>[];

  @override
  Future<String> transferir(String token, int turnoId, int aColaId) async {
    transferencias.add('$turnoId->$aColaId');
    return 'P-001';
  }

  @override
  Future<List<ColaNegocio>> colas(String token) async =>
      const [ColaNegocio(id: 10, prefijo: 'R', nombre: 'Dra. Ríos', activa: true, ventanillas: ['Consultorio 1'])];

  @override
  Future<void> crearCola(String token, {required String prefijo, required String nombre}) async {}

  @override
  Future<void> activarCola(String token, int id, bool activa) async {}

  @override
  Future<void> eliminarCola(String token, int id) async {}

  @override
  Future<List<VentanillaNegocio>> ventanillas(String token) async =>
      const [VentanillaNegocio(id: 1, nombre: 'Consultorio 1', activa: true, colaId: 10, cola: 'Dra. Ríos')];

  @override
  Future<void> crearVentanilla(String token, {required String nombre, required int colaId}) async {}

  @override
  Future<void> editarVentanilla(String token, int id, {String? nombre, bool? activa}) async {}

  @override
  Future<WhatsAppNegocio> whatsapp(String token) async => const WhatsAppNegocio(configurado: true, estado: 'sin_sesion');

  @override
  Future<WhatsAppNegocio> accionWhatsapp(String token, String accion, {String? telefono}) async => WhatsAppNegocio(
      configurado: true, estado: 'qr_ready', numero: '+51951234567', codigo: accion == 'codigo' ? 'ABCD1234' : null);
}
