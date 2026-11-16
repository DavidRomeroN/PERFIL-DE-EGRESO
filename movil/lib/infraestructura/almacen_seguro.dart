import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../dominio/modelos.dart';
import '../dominio/puertos.dart';

/// Guarda el turno activo, el identificador del dispositivo y la sesión en el almacén cifrado del sistema
/// (Keystore en Android, Keychain en iOS). Nada de esto queda en texto plano en el teléfono.
class AlmacenSeguro implements AlmacenTurno, AlmacenCuenta {
  AlmacenSeguro({FlutterSecureStorage? almacen}) : _almacen = almacen ?? const FlutterSecureStorage();

  final FlutterSecureStorage _almacen;

  static const _turno = 'turno_token';
  static const _dispositivo = 'dispositivo_id';
  static const _sesion = 'sesion';
  static const _letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // ── Turno activo ──

  @override
  Future<String?> leer() async {
    final token = await _almacen.read(key: _turno);
    if (token != null) return token;
    return _migrarDePreferencias();
  }

  @override
  Future<void> guardar(String token) => _almacen.write(key: _turno, value: token);

  @override
  Future<void> borrar() => _almacen.delete(key: _turno);

  /// Las versiones anteriores guardaban el token en las preferencias (sin cifrar): se mueve una sola vez.
  Future<String?> _migrarDePreferencias() async {
    final preferencias = await SharedPreferences.getInstance();
    final viejo = preferencias.getString(_turno);
    if (viejo == null) return null;
    await _almacen.write(key: _turno, value: viejo);
    await preferencias.remove(_turno);
    return viejo;
  }

  // ── Cuenta ──

  @override
  Future<String> dispositivo() async {
    final existente = await _almacen.read(key: _dispositivo);
    if (existente != null && existente.length >= 16) return existente;
    final azar = Random.secure();
    final nuevo = String.fromCharCodes(List.generate(32, (_) => _letras.codeUnitAt(azar.nextInt(_letras.length))));
    await _almacen.write(key: _dispositivo, value: nuevo);
    return nuevo;
  }

  @override
  Future<Sesion?> leerSesion() async {
    final texto = await _almacen.read(key: _sesion);
    if (texto == null) return null;
    try {
      final d = jsonDecode(texto) as Map<String, dynamic>;
      return Sesion(
          token: d['token'] as String,
          cuenta: Cuenta(telefono: d['telefono'] as String?, correo: d['correo'] as String?, nombre: d['nombre'] as String?));
    } on Object {
      await borrarSesion();
      return null;
    }
  }

  @override
  Future<void> guardarSesion(Sesion sesion) => _almacen.write(
      key: _sesion, value: jsonEncode({
        'token': sesion.token,
        'telefono': sesion.cuenta.telefono,
        'correo': sesion.cuenta.correo,
        'nombre': sesion.cuenta.nombre,
      }));

  @override
  Future<void> borrarSesion() => _almacen.delete(key: _sesion);
}
