/// Lo que la app lee del QR de un local.
class DatosQr {
  const DatosQr(this.slug, [this.presencia]);

  final String slug;

  /// Marca firmada del QR de la TV (`?p=`): prueba de que el cliente está en el local. El servidor la exige para
  /// tomar turno y vence a los pocos minutos; el QR impreso y los locales abiertos desde «Mis locales» no la traen.
  final String? presencia;
}

/// Lee el slug del local y la marca de presencia desde el contenido de un QR.
///
/// Acepta el QR de la app en la TV (`https://…/l/<slug>/app?p=<marca>`), el QR web (`https://…/l/<slug>`), el esquema
/// propio (`turnoya://l/<slug>?p=<marca>`) o solo el slug (así se abren los locales guardados en «Mis locales», sin marca).
DatosQr? leerQr(String contenido) {
  final texto = contenido.trim();
  final marca = RegExp(r'[?&]p=([A-Za-z0-9._-]{4,64})(?:[&#]|$)').firstMatch(texto)?.group(1);
  final enRuta = RegExp(r'/l/([a-z0-9][a-z0-9-]{0,62})(?:[/?#]|$)', caseSensitive: false).firstMatch(texto);
  if (enRuta != null) return DatosQr(enRuta.group(1)!.toLowerCase(), marca);
  final esquema = RegExp(r'^turnoya://l/([a-z0-9][a-z0-9-]{0,62})', caseSensitive: false).firstMatch(texto);
  if (esquema != null) return DatosQr(esquema.group(1)!.toLowerCase(), marca);
  if (RegExp(r'^[a-z0-9][a-z0-9-]{0,62}$', caseSensitive: false).hasMatch(texto)) return DatosQr(texto.toLowerCase());
  return null;
}

/// Solo el slug del local (ver [leerQr]).
String? slugDesdeQr(String contenido) => leerQr(contenido)?.slug;
