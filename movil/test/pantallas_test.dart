import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:turnoya_movil/aplicacion/casos_de_uso.dart';
import 'package:turnoya_movil/dominio/modelos.dart';
import 'package:turnoya_movil/main.dart';
import 'package:turnoya_movil/presentacion/dependencias.dart';
import 'package:turnoya_movil/presentacion/sesion_app.dart';

import 'dominio_test.dart';

/// Arma la app con dobles (sin red ni almacén del teléfono) y recorre las pestañas: detecta errores de diseño o de
/// ciclo de vida que solo saltan al dibujar.
Future<SesionApp> montar(WidgetTester tester, CuentaFalsa cuenta) async {
  final servicio = ServicioFalso([turno()]);
  final almacen = AlmacenFalso();
  final locales = MisLocales(LocalesEnMemoria());
  final sesion = SesionApp(CuentaActual(cuenta), CerrarSesion(servicio, cuenta));
  await sesion.cargar();
  await tester.pumpWidget(Dependencias(
    abrirLocal: AbrirLocal(servicio, misLocales: locales),
    tomarTurno: TomarTurno(servicio, almacen, cuenta),
    recuperarTurno: RecuperarTurno(servicio, almacen),
    seguirTurno: SeguirTurno(servicio, NotificadorFalso()),
    cancelarTurno: CancelarTurno(servicio, almacen),
    olvidarTurno: OlvidarTurno(almacen),
    pedirCodigo: PedirCodigo(servicio),
    iniciarSesion: IniciarSesion(servicio, cuenta),
    cuentaActual: CuentaActual(cuenta),
    cerrarSesion: CerrarSesion(servicio, cuenta),
    verHistorial: VerHistorial(servicio, cuenta),
    retomarTurno: RetomarTurno(servicio, almacen),
    misLocales: locales,
    mejoresHoras: MejoresHoras(servicio),
    registrarCuenta: RegistrarCuenta(servicio, cuenta),
    ingresarConCorreo: IngresarConCorreo(servicio, cuenta),
    verPerfil: VerPerfil(servicio, cuenta),
    citas: CitasDelCliente(CitasFalsas(), cuenta),
    personal: PersonalDelNegocio(PersonalFalso(), PersonalEnMemoria()),
    sesion: sesion,
    child: const AppTurnoYa(),
  ));
  await tester.pumpAndSettle();
  return sesion;
}

void main() {
  testWidgets('sin cuenta: recorre las pestañas y crea la cuenta con correo', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final cuenta = CuentaFalsa();
    final sesion = await montar(tester, cuenta);

    expect(find.text('Escanear QR del local'), findsOneWidget);
    expect(find.text('Crea tu cuenta gratis'), findsOneWidget);

    await tester.tap(find.text('Locales'));
    await tester.pumpAndSettle();
    expect(find.text('Mis locales'), findsWidgets);

    await tester.tap(find.text('Mis turnos'));
    await tester.pumpAndSettle();
    expect(find.text('Guarda tu historial'), findsOneWidget);

    await tester.tap(find.text('Ingresar').last);
    await tester.pumpAndSettle();
    expect(find.text('Tu cuenta TurnoYa'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextField, 'Nombre y apellido'), 'Ana Quispe');
    await tester.enterText(find.widgetWithText(TextField, 'Correo'), 'ana@gmail.com');
    await tester.enterText(find.widgetWithText(TextField, 'Contraseña'), 'segura123');
    final lista = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first;
    // Se baja hasta el botón para que la casilla no quede detrás de la barra de pestañas
    await tester.scrollUntilVisible(find.text('Crear mi cuenta'), 200, scrollable: lista);
    await tester.ensureVisible(find.text('Crear mi cuenta'));
    await tester.drag(lista, const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.text('Crear mi cuenta'));
    await tester.pumpAndSettle();

    expect(sesion.cuenta?.correo, 'ana@gmail.com');
    expect(cuenta.sesion?.token, 'ses-reg');
    // Ya con cuenta, la pestaña muestra el perfil y el estado sin faltas
    expect(find.text('Sin penalizaciones'), findsOneWidget);
    expect(find.text('Cerrar sesión'), findsOneWidget);
  });

  testWidgets('con cuenta: el inicio saluda y mis turnos carga el historial', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await montar(tester, CuentaFalsa()..sesion = const Sesion(token: 't', cuenta: Cuenta(correo: 'a@b.pe', nombre: 'Luis Mamani')));

    expect(find.text('Hola, Luis'), findsOneWidget);
    expect(find.text('Crea tu cuenta gratis'), findsNothing);

    await tester.tap(find.text('Mis turnos'));
    await tester.pumpAndSettle();
    expect(find.text('Aún no tienes turnos'), findsOneWidget);
  });
}
