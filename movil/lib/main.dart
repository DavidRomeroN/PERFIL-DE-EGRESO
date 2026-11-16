import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'aplicacion/casos_de_uso.dart';
import 'dominio/url_servidor.dart';
import 'infraestructura/almacen_locales.dart';
import 'infraestructura/almacen_seguro.dart';
import 'infraestructura/api_turnoya.dart';
import 'infraestructura/notificador_local.dart';
import 'presentacion/app_principal.dart';
import 'presentacion/dependencias.dart';
import 'presentacion/pantalla_negocio.dart';
import 'presentacion/sesion_app.dart';
import 'presentacion/tema.dart';

/// URL del servidor. En el emulador de Android, 10.0.2.2 es el localhost de la PC:
/// `flutter run --dart-define=TURNOYA_URL=http://10.0.2.2:8080`. La versión de producción
/// (`flutter build --release`) exige HTTPS.
const urlServidor = String.fromEnvironment('TURNOYA_URL', defaultValue: 'http://10.0.2.2:8080');

/// Raíz de composición: aquí (y solo aquí) se conectan los adaptadores con los casos de uso.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final servicio = ApiTurnoYa(validarUrlServidor(urlServidor, produccion: kReleaseMode));
  final almacen = AlmacenSeguro();
  final misLocales = MisLocales(AlmacenLocalesPreferencias());
  final notificador = NotificadorLocal();
  await notificador.preparar();
  final sesion = SesionApp(CuentaActual(almacen), CerrarSesion(servicio, almacen));
  await sesion.cargar();

  runApp(Dependencias(
    abrirLocal: AbrirLocal(servicio, misLocales: misLocales),
    tomarTurno: TomarTurno(servicio, almacen, almacen),
    recuperarTurno: RecuperarTurno(servicio, almacen),
    seguirTurno: SeguirTurno(servicio, notificador),
    cancelarTurno: CancelarTurno(servicio, almacen),
    olvidarTurno: OlvidarTurno(almacen),
    pedirCodigo: PedirCodigo(servicio),
    iniciarSesion: IniciarSesion(servicio, almacen),
    cuentaActual: CuentaActual(almacen),
    cerrarSesion: CerrarSesion(servicio, almacen),
    verHistorial: VerHistorial(servicio, almacen),
    retomarTurno: RetomarTurno(servicio, almacen),
    misLocales: misLocales,
    mejoresHoras: MejoresHoras(servicio),
    registrarCuenta: RegistrarCuenta(servicio, almacen),
    ingresarConCorreo: IngresarConCorreo(servicio, almacen),
    verPerfil: VerPerfil(servicio, almacen),
    citas: CitasDelCliente(servicio, almacen),
    personal: PersonalDelNegocio(servicio, almacen),
    sesion: sesion,
    child: const AppTurnoYa(),
  ));
}

class AppTurnoYa extends StatelessWidget {
  const AppTurnoYa({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TurnoYa',
      debugShowCheckedModeBanner: false,
      theme: temaTurnoYa(),
      home: const _Raiz(),
    );
  }
}

/// Si en este teléfono ingresó el personal de un negocio, abre directo su panel; si no, la app del cliente.
class _Raiz extends StatefulWidget {
  const _Raiz();

  @override
  State<_Raiz> createState() => _RaizState();
}

class _RaizState extends State<_Raiz> {
  bool? _negocio;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_negocio == null) {
      Dependencias.de(context).personal.sesion().then((s) {
        if (mounted) setState(() => _negocio = s != null);
      });
    }
  }

  @override
  Widget build(BuildContext context) => switch (_negocio) {
        null => const Scaffold(body: Center(child: CircularProgressIndicator())),
        true => PantallaNegocio(alSalir: () => setState(() => _negocio = false)),
        false => const PantallaPrincipal(),
      };
}
