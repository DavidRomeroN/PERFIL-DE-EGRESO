import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:turnoya_movil/aplicacion/casos_de_uso.dart';
import 'package:turnoya_movil/dominio/modelos.dart';
import 'package:turnoya_movil/main.dart';
import 'package:turnoya_movil/presentacion/dependencias.dart';
import 'package:turnoya_movil/presentacion/sesion_app.dart';

import 'dominio_test.dart';

/// La app con el personal ya ingresado (abre directo el panel del negocio).
Future<void> montarNegocio(WidgetTester tester, PersonalFalso servicio) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final cliente = ServicioFalso([turno()]);
  final cuenta = CuentaFalsa();
  final almacen = AlmacenFalso();
  final locales = MisLocales(LocalesEnMemoria());
  final personal = PersonalDelNegocio(servicio, PersonalEnMemoria());
  await personal.ingresar('rios@dentalsonrisa.pe', 'operador123');
  final sesion = SesionApp(CuentaActual(cuenta), CerrarSesion(cliente, cuenta));
  await tester.pumpWidget(Dependencias(
    abrirLocal: AbrirLocal(cliente, misLocales: locales),
    tomarTurno: TomarTurno(cliente, almacen, cuenta),
    recuperarTurno: RecuperarTurno(cliente, almacen),
    seguirTurno: SeguirTurno(cliente, NotificadorFalso()),
    cancelarTurno: CancelarTurno(cliente, almacen),
    olvidarTurno: OlvidarTurno(almacen),
    pedirCodigo: PedirCodigo(cliente),
    iniciarSesion: IniciarSesion(cliente, cuenta),
    cuentaActual: CuentaActual(cuenta),
    cerrarSesion: CerrarSesion(cliente, cuenta),
    verHistorial: VerHistorial(cliente, cuenta),
    retomarTurno: RetomarTurno(cliente, almacen),
    misLocales: locales,
    mejoresHoras: MejoresHoras(cliente),
    registrarCuenta: RegistrarCuenta(cliente, cuenta),
    ingresarConCorreo: IngresarConCorreo(cliente, cuenta),
    verPerfil: VerPerfil(cliente, cuenta),
    citas: CitasDelCliente(CitasFalsas(), cuenta),
    personal: personal,
    sesion: sesion,
    child: const AppTurnoYa(),
  ));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  test('el ticket con celular exige el permiso del cliente', () async {
    final servicio = PersonalFalso();
    final personal = PersonalDelNegocio(servicio, PersonalEnMemoria());
    await personal.ingresar('rios@dentalsonrisa.pe', 'operador123');
    final error = await personal.ticket(colaId: 10, telefono: '951 234 567').then((_) => '', onError: (Object e) => (e as ErrorTurno).codigo);
    expect(error, 'CONSENTIMIENTO_REQUERIDO');
    await personal.ticket(colaId: 10, nombre: ' Ana ', telefono: '951 234 567', consentimiento: true);
    expect(servicio.ticket, {'colaId': 10, 'nombre': 'Ana', 'telefono': '951234567', 'consentimiento': true});
  });

  test('si el token venció, borra la sesión del personal', () async {
    final servicio = PersonalFalso();
    final almacen = PersonalEnMemoria();
    final personal = PersonalDelNegocio(servicio, almacen);
    await personal.ingresar('rios@dentalsonrisa.pe', 'operador123');
    servicio.vencida = true;
    await expectLater(personal.panel(), throwsA(isA<ErrorTurno>()));
    expect(almacen.sesion, isNull);
  });

  testWidgets('operador con una sola ventanilla entra directo a ella y llama', (tester) async {
    final servicio = PersonalFalso();
    await montarNegocio(tester, servicio);
    expect(find.text('Consultorio 1 · Dra. Ríos'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    await tester.tap(find.text('Llamar al siguiente  R-002'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(servicio.llamadas, [1]);
  });

  testWidgets('con varias ventanillas lista solo las suyas, cada una con su botón de llamar', (tester) async {
    final servicio = PersonalFalso(dosVentanillas: true);
    await montarNegocio(tester, servicio);
    expect(find.text('Tus ventanillas'), findsOneWidget);
    expect(find.text('Consultorio 1'), findsOneWidget);
    expect(find.text('Consultorio 2'), findsOneWidget);
    expect(find.text('Llamar siguiente  R-002'), findsOneWidget);
    expect(find.text('Nadie en espera'), findsOneWidget);
    await tester.tap(find.text('Llamar siguiente  R-002'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(servicio.llamadas, [1]);
    await tester.tap(find.text('Ver').last);
    await tester.pump();
    expect(find.text('Consultorio 2 · Dr. Paredes'), findsOneWidget);
  });

  testWidgets('la recepción emite tickets en cualquier cola y transfiere sin llamar', (tester) async {
    final servicio = PersonalFalso(rol: 'KIOSCO');
    await montarNegocio(tester, servicio);
    expect(find.text('Emitir ticket'), findsOneWidget);
    expect(find.text('Dr. Paredes'), findsOneWidget);
    expect(find.text('1 en espera · ~5 min'), findsOneWidget);
    expect(find.text('R-002'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.textContaining('Llamar'), findsNothing);

    await tester.tap(find.text('Dr. Paredes'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Nombre (opcional)'), 'Luis');
    await tester.tap(find.widgetWithText(FilledButton, 'Emitir ticket'));
    await tester.pumpAndSettle();
    expect(servicio.ticket, {'recepcion': true, 'colaId': 11, 'nombre': 'Luis', 'telefono': null, 'consentimiento': false});

    await tester.tap(find.text('Transferir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('P · Dr. Paredes'));
    await tester.pumpAndSettle();
    expect(servicio.transferencias, ['5->11']);
  });

  testWidgets('el admin tiene colas, ventanillas y WhatsApp con código', (tester) async {
    await montarNegocio(tester, PersonalFalso(rol: 'ADMIN_LOCAL'));
    expect(find.byType(NavigationBar), findsOneWidget);
    await tester.tap(find.text('Colas'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Nueva cola'), findsOneWidget);
    await tester.tap(find.text('WhatsApp').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(find.widgetWithText(TextField, 'Celular con WhatsApp'), '951234567');
    await tester.tap(find.text('Guardar'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Pedir código'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('ABCD1234'), findsOneWidget);
  });
}
