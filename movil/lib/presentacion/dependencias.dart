import 'package:flutter/material.dart';
import 'tema.dart';

import '../aplicacion/casos_de_uso.dart';
import 'sesion_app.dart';

/// Casos de uso que usan las pantallas (los arma `main.dart`, la raíz de composición).
class Dependencias extends InheritedWidget {
  const Dependencias({
    super.key,
    required this.abrirLocal,
    required this.tomarTurno,
    required this.recuperarTurno,
    required this.seguirTurno,
    required this.cancelarTurno,
    required this.olvidarTurno,
    required this.pedirCodigo,
    required this.iniciarSesion,
    required this.cuentaActual,
    required this.cerrarSesion,
    required this.verHistorial,
    required this.retomarTurno,
    required this.misLocales,
    required this.mejoresHoras,
    required this.registrarCuenta,
    required this.ingresarConCorreo,
    required this.verPerfil,
    required this.citas,
    required this.personal,
    required this.sesion,
    required super.child,
  });

  final AbrirLocal abrirLocal;
  final TomarTurno tomarTurno;
  final RecuperarTurno recuperarTurno;
  final SeguirTurno seguirTurno;
  final CancelarTurno cancelarTurno;
  final OlvidarTurno olvidarTurno;
  final PedirCodigo pedirCodigo;
  final IniciarSesion iniciarSesion;
  final CuentaActual cuentaActual;
  final CerrarSesion cerrarSesion;
  final VerHistorial verHistorial;
  final RetomarTurno retomarTurno;
  final MisLocales misLocales;
  final MejoresHoras mejoresHoras;
  final RegistrarCuenta registrarCuenta;
  final IngresarConCorreo ingresarConCorreo;
  final VerPerfil verPerfil;
  final CitasDelCliente citas;
  final PersonalDelNegocio personal;

  /// Cuenta actual, compartida por todas las pantallas.
  final SesionApp sesion;

  static Dependencias de(BuildContext context) => context.dependOnInheritedWidgetOfExactType<Dependencias>()!;

  @override
  bool updateShouldNotify(Dependencias oldWidget) => false;
}

/// `#2563eb` → Color.
Color colorDesdeHex(String hex, {Color porDefecto = ColoresTurnoYa.primario}) {
  final limpio = hex.replaceFirst('#', '');
  final valor = int.tryParse(limpio.length == 6 ? 'FF$limpio' : limpio, radix: 16);
  return valor == null ? porDefecto : Color(valor);
}
