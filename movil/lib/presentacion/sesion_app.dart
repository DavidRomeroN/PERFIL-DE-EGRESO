import 'package:flutter/foundation.dart';

import '../aplicacion/casos_de_uso.dart';
import '../dominio/modelos.dart';

/// La cuenta con que el cliente ingresó, compartida por todas las pantallas: al ingresar o cerrar sesión en una,
/// las demás se actualizan (inicio, mis turnos, cuenta, local).
class SesionApp extends ChangeNotifier {
  SesionApp(this._cuentaActual, this._cerrarSesion);

  final CuentaActual _cuentaActual;
  final CerrarSesion _cerrarSesion;

  Cuenta? _cuenta;

  Cuenta? get cuenta => _cuenta;

  bool get conCuenta => _cuenta != null;

  Future<void> cargar() async {
    _cuenta = await _cuentaActual();
    notifyListeners();
  }

  void establecer(Cuenta? cuenta) {
    _cuenta = cuenta;
    notifyListeners();
  }

  Future<void> cerrar() async {
    await _cerrarSesion();
    establecer(null);
  }
}
