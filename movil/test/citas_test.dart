import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:turnoya_movil/aplicacion/casos_de_uso.dart';
import 'package:turnoya_movil/dominio/modelos.dart';

import 'dominio_test.dart';
import 'pantallas_test.dart';

void main() {
  group('check-in de la cita', () {
    late CitasFalsas servicio;
    late CitasDelCliente citas;

    setUp(() {
      servicio = CitasFalsas();
      citas = CitasDelCliente(servicio, conCuenta());
    });

    Future<String> codigo(Future<Object?> f) => f.then((_) => 'OK', onError: (Object e) => (e as ErrorTurno).codigo);

    test('con el QR «App» del mismo local envía la marca de presencia', () async {
      final cita = (await citas.mias()).citas.first;
      final llegada = await citas.llegue(cita, 'https://turnoya.pe/l/centro/app?p=marca-1234');
      expect(llegada.codigo, 'C-001');
      expect(servicio.presenciaRecibida, 'marca-1234');
    });

    test('rechaza el QR sin marca (impreso) y el de otro local', () async {
      final cita = (await citas.mias()).citas.first;
      expect(await codigo(citas.llegue(cita, 'https://turnoya.pe/l/centro')), 'QR_INVALIDO');
      expect(await codigo(citas.llegue(cita, 'https://turnoya.pe/l/otro/app?p=marca-1234')), 'QR_OTRO_LOCAL');
      expect(servicio.presenciaRecibida, isNull);
    });

    test('sin cuenta no se puede reservar', () async {
      final sinCuenta = CitasDelCliente(servicio, CuentaFalsa());
      expect(await codigo(sinCuenta.reservar(slug: 'centro', servicioId: 1, horarioId: 9)), 'APP_SESION_INVALIDA');
    });
  });

  testWidgets('pestaña «Citas» muestra la cita y la sanción', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await montar(tester, conCuenta());

    await tester.tap(find.text('Citas'));
    await tester.pumpAndSettle();
    expect(find.text('Mis citas'), findsOneWidget);
    expect(find.text('Consulta'), findsOneWidget);
    expect(find.text('Ya llegué'), findsOneWidget);
    expect(find.textContaining('Sin citas en Otro local'), findsOneWidget);
  });

  testWidgets('«Reservar cita» lista todos los locales con citas, aunque nunca los haya visitado', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await montar(tester, conCuenta());

    await tester.tap(find.text('Citas'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reservar cita'));
    await tester.pumpAndSettle();
    expect(find.text('2 locales reciben citas'), findsOneWidget);
    expect(find.text('Dental Sonrisa'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'dental');
    await tester.pump();
    expect(find.text('Centro'), findsNothing);
    await tester.tap(find.text('Dental Sonrisa'));
    await tester.pumpAndSettle();
    expect(find.text('Consulta'), findsOneWidget);
  });
}

CuentaFalsa conCuenta() =>
    CuentaFalsa()..sesion = const Sesion(token: 'sesion-1', cuenta: Cuenta(nombre: 'Ana', correo: 'ana@correo.pe'));
