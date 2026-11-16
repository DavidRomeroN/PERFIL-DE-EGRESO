import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../dominio/puertos.dart';

/// Notificaciones locales del teléfono (sin Firebase): se disparan desde el seguimiento en vivo.
class NotificadorLocal implements Notificador {
  final _plugin = FlutterLocalNotificationsPlugin();
  var _id = 0;

  static const _detalles = NotificationDetails(
    android: AndroidNotificationDetails(
      'turno',
      'Avisos del turno',
      channelDescription: 'Te avisa cuando tu turno está cerca y cuando te llaman',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
  );

  @override
  Future<void> preparar() async {
    await _plugin.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    // Android 13+ pide permiso para mostrar notificaciones
    await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
  }

  @override
  Future<void> avisar(String titulo, String cuerpo) =>
      _plugin.show(_id++, titulo, cuerpo, _detalles);
}
