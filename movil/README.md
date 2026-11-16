# TurnoYa · app del cliente (Flutter)

App exclusiva para el cliente final: escanea el **QR «App»** de la pantalla TV del local, elige el servicio, toma su
turno y lo sigue en vivo. El turno se emite con canal `APP` y entra en **la misma cola** que los de WhatsApp y la web.
Con una **cuenta** (correo y contraseña, o su celular por WhatsApp) sus turnos quedan a su nombre, ve su historial en
todos los locales, las mejores horas para ir y si tiene alguna penalización.

## Qué puede hacer el cliente

La app tiene cuatro pestañas abajo: **Inicio**, **Locales**, **Mis turnos** y **Cuenta** («Ingresar» si no tiene).

- **Inicio**: saludo, el botón «Escanear QR del local», su turno activo (con un toque vuelve a él), sus locales y cómo
  funciona.
- **Mis locales**: los locales que visitó y sus favoritos (⭐); los abre sin escanear para ver la espera en vivo y las
  **mejores horas para ir** (predicción, si el local tiene el módulo; solo con cuenta). Para tomar turno igual hay que escanear allí.
- **Atención preferencial**: al tomar turno elige su categoría (adulto mayor, gestante…) si el local la ofrece; la app
  le avisa qué documento llevar.
- **Mis turnos** (con cuenta): historial «En curso» / «Anteriores» y seguimiento de los turnos activos.
- **Cuenta**: crear cuenta con nombre, correo y contraseña (o ingresar). Con sesión muestra el perfil: datos, turnos
  activo (solo uno a la vez) y el **estado de penalización** (faltas de los últimos 7 días, cuántas le quedan y hasta cuándo está
  bloqueado si llegó a 3).

## Seguridad

- **QR de presencia**: el QR «App» de la TV lleva una marca firmada (`?p=`, HMAC del servidor) que cambia cada 5 min.
  Sin ella no se toma turno: una foto vieja del QR no sirve, y desde «Mis locales» solo se ve la espera. La app no permite escribir el código del local: todo entra por QR.
- **Un turno activo por teléfono y cola**: cada instalación genera un identificador aleatorio; si ya hay un turno
  activo, la app retoma ese turno en vez de crear otro. Cada cuenta (o teléfono) tiene un solo turno activo a la vez entre
  todos los locales (`turnoya.app.max-activos`).
- **Castigo por no venir**: con 3 turnos «no se presentó» en 7 días (por teléfono o por cuenta) la app no deja tomar
  turno hasta que la falta más antigua cumpla 7 días (`turnoya.app.max-faltas`, `turnoya.app.dias-faltas`).
- **Ticket vivo**: el ticket tiene franjas que se mueven y la hora con segundos, y Android bloquea capturas y grabaciones
  de esa pantalla (`FLAG_SECURE`): en la ventanilla una foto revendida se nota.
- **Almacén cifrado**: el turno, el identificador y la sesión viven en `flutter_secure_storage` (Keystore / Keychain),
  no en preferencias en texto plano. Las copias de seguridad de Android están desactivadas.
- **Solo HTTPS en producción**: el manifiesto principal prohíbe HTTP; solo el de *debug* lo permite, y `main.dart`
  rechaza una `TURNOYA_URL` con `http://` en *release* (en desarrollo solo hacia localhost, `10.0.2.2` o la red local).
- **Cuenta con correo**: la contraseña (8 a 72 caracteres, con letra y número) se guarda con hash (`PasswordEncoder`);
  5 contraseñas malas bloquean la cuenta 15 min. El correo no se verifica todavía (no hay servidor de correo).
- **Cuenta con celular**: código de 6 dígitos por el WhatsApp del local (vence en 10 min, 5 intentos, uno por minuto). La sesión es
  un token aleatorio que el servidor guarda con hash.

## Arquitectura hexagonal (simple)

```
lib/
  dominio/          modelos (Local, Cola, Turno, Sesion…), lectura del QR, regla de la URL y puertos
                    (ServicioTurnos, AlmacenTurno, AlmacenCuenta, Notificador)
  aplicacion/       casos de uso: AbrirLocal, TomarTurno, RecuperarTurno, SeguirTurno, CancelarTurno, OlvidarTurno,
                    PedirCodigo, IniciarSesion, CuentaActual, CerrarSesion, VerHistorial, RetomarTurno,
                    MisLocales, MejoresHoras, RegistrarCuenta, IngresarConCorreo, VerPerfil
  infraestructura/  adaptadores: ApiTurnoYa (HTTP + SSE), AlmacenSeguro, AlmacenLocalesPreferencias, NotificadorLocal
  presentacion/     tema, SesionApp (estado de la cuenta compartido) y pantallas (principal con pestañas, inicio,
                    escáner, local, mis locales, acceso con correo, perfil, ingresar con celular, mis turnos,
                    mi turno + ticket vivo)
  main.dart         raíz de composición: conecta los adaptadores con los casos de uso
```

El dominio y los casos de uso no importan Flutter ni `http`; se prueban con dobles (`test/dominio_test.dart`). Las
pantallas se prueban con `test/pantallas_test.dart` (recorre las pestañas y crea una cuenta).

## Seguimiento en vivo

`SeguirTurno` escucha el canal SSE del local (`/api/v1/realtime/<slug>`) y vuelve a consultar el turno con cada
cambio, más una consulta de respaldo cada 15 s. Lanza una notificación local (sin Firebase) cuando faltan
`avisarFaltando` personas o menos y otra cuando llaman al turno.

## API que usa

| Petición | Para qué |
|---|---|
| `GET /api/v1/public/locales/{slug}` | servicios del local y su espera |
| `POST /api/v1/public/app/turnos` con `{colaId, nombre, categoriaCodigo, presencia, dispositivo}` (+ `Authorization: Bearer` opcional) | tomar turno |
| `GET /api/v1/public/turnos/{token}` · `DELETE …` | estado del turno · cancelar |
| `POST /api/v1/public/app/registro` con `{correo, clave, nombre, consentimiento, dispositivo}` | crear la cuenta con correo |
| `POST /api/v1/public/app/ingreso` con `{correo, clave, dispositivo}` | ingresar con correo |
| `GET /api/v1/public/app/perfil` (+ `X-Dispositivo`) | datos de la cuenta, faltas y turnos activos |
| `POST /api/v1/public/app/codigo` con `{slug, telefono}` | enviar el código por WhatsApp |
| `POST /api/v1/public/app/sesion` · `DELETE …` | verificar el código y abrir sesión · cerrarla |
| `GET /api/v1/public/app/turnos` | historial del cliente |
| `GET /api/v1/public/colas/{id}/mejores-horas` | mejores horas de hoy para ir |
| `GET /api/v1/realtime/{slug}` (SSE) | avisos de cambios del local |

Las versiones anteriores de la app (que usaban `POST /api/v1/public/turnos` con canal `APP`) reciben
`426 APP_ACTUALIZAR`.

## Ejecutar

```bash
flutter pub get
flutter run --dart-define=TURNOYA_URL=http://10.0.2.2:8080
```

`10.0.2.2` es el `localhost` de la PC visto desde el emulador de Android; en un teléfono real usa la IP de la PC en la
red local. Para producción: `flutter build apk --release --dart-define=TURNOYA_URL=https://…`. Pruebas:
`flutter analyze` y `flutter test`.
