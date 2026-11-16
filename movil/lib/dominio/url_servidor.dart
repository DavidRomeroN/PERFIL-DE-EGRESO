/// En producción la app solo habla con el servidor por HTTPS: el token de la sesión y el teléfono viajan cifrados.
/// HTTP se permite únicamente en desarrollo hacia la PC (localhost, 10.0.2.2 del emulador o una IP de la red local).
String validarUrlServidor(String url, {required bool produccion}) {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasAuthority || (uri.scheme != 'https' && uri.scheme != 'http')) {
    throw ArgumentError.value(url, 'TURNOYA_URL', 'no es una URL válida');
  }
  if (uri.scheme == 'http' && (produccion || !esDesarrollo(uri.host))) {
    throw ArgumentError.value(url, 'TURNOYA_URL', 'debe usar https://');
  }
  return url;
}

/// Hosts de desarrollo: la PC vista desde el emulador o desde un teléfono en la misma red.
bool esDesarrollo(String host) =>
    host == 'localhost' ||
    host == '127.0.0.1' ||
    host == '10.0.2.2' ||
    RegExp(r'^(192\.168|10)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$').hasMatch(host);
