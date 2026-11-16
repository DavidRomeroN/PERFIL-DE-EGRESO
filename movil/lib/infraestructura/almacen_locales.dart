import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../dominio/modelos.dart';
import '../dominio/puertos.dart';

/// Guarda los locales visitados y favoritos en las preferencias: son datos públicos (nombre y color del local).
class AlmacenLocalesPreferencias implements AlmacenLocales {
  static const _clave = 'mis_locales';

  @override
  Future<List<LocalGuardado>> leer() async {
    final texto = (await SharedPreferences.getInstance()).getString(_clave);
    if (texto == null) return const [];
    try {
      return [for (final j in jsonDecode(texto) as List) ?LocalGuardado.desdeJson(j)];
    } on FormatException {
      return const [];
    }
  }

  @override
  Future<void> guardar(List<LocalGuardado> locales) async =>
      (await SharedPreferences.getInstance()).setString(_clave, jsonEncode([for (final l in locales) l.aJson()]));
}
