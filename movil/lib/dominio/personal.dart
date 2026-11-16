/// El negocio desde el celular: el operador llama a sus clientes y emite tickets en sus ventanillas; el admin además
/// crea colas y ventanillas y vincula el WhatsApp desde el que salen los avisos. No es la administración completa
/// (esa sigue en la web).
library;

class SesionPersonal {
  const SesionPersonal({required this.token, required this.nombre, required this.rol, required this.local});

  final String token;
  final String nombre;

  /// `ADMIN_LOCAL`, `OPERADOR` o `KIOSCO` (recepción).
  final String rol;
  final String local;

  bool get esAdmin => rol == 'ADMIN_LOCAL';

  bool get esKiosco => rol == 'KIOSCO';
}

class TurnoPersonal {
  const TurnoPersonal({required this.id, required this.codigo, this.nombre, required this.canal, this.rellamadas = 0, this.categoria});

  final int id;
  final String codigo;
  final String? nombre;

  /// APP, WHATSAPP, QR, TICKET, CITA…
  final String canal;
  final int rellamadas;
  final String? categoria;
}

class VentanillaPersonal {
  const VentanillaPersonal({
    required this.id,
    required this.nombre,
    required this.colaId,
    required this.cola,
    required this.prefijo,
    required this.enEspera,
    this.actual,
    this.siguientes = const [],
  });

  final int id;
  final String nombre;
  final int colaId;
  final String cola;
  final String prefijo;
  final int enEspera;

  /// El turno que está atendiendo (llamado), si hay.
  final TurnoPersonal? actual;
  final List<TurnoPersonal> siguientes;
}

class ColaTicket {
  const ColaTicket({required this.id, required this.nombre, required this.prefijo});

  final int id;
  final String nombre;
  final String prefijo;
}

/// Lo que ve el personal: sus ventanillas (todas si es admin).
class PanelPersonal {
  const PanelPersonal({
    required this.usuario,
    required this.esAdmin,
    required this.local,
    required this.slug,
    this.plan,
    required this.whatsapp,
    required this.ventanillas,
    required this.colasTicket,
  });

  final String usuario;
  final bool esAdmin;
  final String local;
  final String slug;
  final String? plan;

  /// El plan incluye avisos por WhatsApp.
  final bool whatsapp;
  final List<VentanillaPersonal> ventanillas;
  final List<ColaTicket> colasTicket;
}

/// Una cola vista desde la recepción (kiosco).
class ColaKiosco {
  const ColaKiosco({required this.id, required this.nombre, required this.prefijo, required this.enEspera, this.tiempoEstimadoSeg = 0});

  final int id;
  final String nombre;
  final String prefijo;
  final int enEspera;
  final int tiempoEstimadoSeg;
}

/// Un cliente que espera, en cualquier cola del local.
class EsperaKiosco {
  const EsperaKiosco({
    required this.id,
    required this.codigo,
    this.nombre,
    required this.canal,
    required this.emitidoAt,
    required this.colaId,
    required this.cola,
    required this.prefijo,
  });

  final int id;
  final String codigo;
  final String? nombre;
  final String canal;
  final DateTime emitidoAt;
  final int colaId;
  final String cola;
  final String prefijo;
}

/// La recepción del local: emite tickets en cualquier cola y ve a todos los que esperan; no llama turnos.
class PanelKiosco {
  const PanelKiosco({
    required this.usuario,
    required this.local,
    required this.slug,
    required this.whatsapp,
    required this.colas,
    required this.espera,
    this.puedeTransferir = false,
  });

  final String usuario;
  final String local;
  final String slug;
  final bool whatsapp;
  final List<ColaKiosco> colas;
  final List<EsperaKiosco> espera;

  /// El plan permite pasar a un cliente a otra cola (y hay más de una).
  final bool puedeTransferir;
}

class TicketEmitido {
  const TicketEmitido({required this.codigo, required this.token});

  final String codigo;
  final String token;
}

class ColaNegocio {
  const ColaNegocio({required this.id, required this.prefijo, required this.nombre, required this.activa, required this.ventanillas});

  final int id;
  final String prefijo;
  final String nombre;
  final bool activa;
  final List<String> ventanillas;
}

class VentanillaNegocio {
  const VentanillaNegocio({required this.id, required this.nombre, required this.activa, this.colaId, this.cola});

  final int id;
  final String nombre;
  final bool activa;
  final int? colaId;
  final String? cola;
}

/// Estado del WhatsApp del negocio (sesión de OpenWA).
class WhatsAppNegocio {
  const WhatsAppNegocio({
    required this.configurado,
    required this.estado,
    this.telefono,
    this.nombre,
    this.numero,
    this.codigo,
    this.error,
  });

  /// El servidor tiene OpenWA configurado.
  final bool configurado;

  /// `ready` (conectado), `qr_ready`, `sin_sesion`…
  final String estado;

  /// Teléfono que quedó vinculado.
  final String? telefono;
  final String? nombre;

  /// Número que el negocio registró para enviar sus avisos.
  final String? numero;

  /// Código de vinculación recién pedido.
  final String? codigo;
  final String? error;

  bool get conectado => estado == 'ready';
}

/// Puerto: la API del personal (`/api/v1`, con `Authorization: Bearer <token del personal>`).
abstract interface class ServicioPersonal {
  Future<SesionPersonal> ingresarPersonal(String correo, String clave);

  Future<PanelPersonal> panel(String token);

  /// `null` si la cola está vacía.
  Future<TurnoPersonal?> llamarSiguiente(String token, int ventanillaId);

  /// [estado]: `ATENDIDO`, `NO_SE_PRESENTO` o `LLAMADO` (volver a llamar).
  Future<void> marcarTurno(String token, int turnoId, String estado);

  Future<TicketEmitido> emitirTicket(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false});

  /// Recepción (kiosco): todas las colas y quienes esperan.
  Future<PanelKiosco> panelKiosco(String token);

  /// Ticket desde la recepción, para cualquier cola del local.
  Future<TicketEmitido> emitirTicketKiosco(String token, {required int colaId, String? nombre, String? telefono, bool consentimiento = false});

  /// Pasa a un cliente que espera a otra cola (conserva su lugar). Devuelve su nuevo código.
  Future<String> transferir(String token, int turnoId, int aColaId);

  Future<List<ColaNegocio>> colas(String token);

  Future<void> crearCola(String token, {required String prefijo, required String nombre});

  Future<void> activarCola(String token, int id, bool activa);

  Future<void> eliminarCola(String token, int id);

  Future<List<VentanillaNegocio>> ventanillas(String token);

  Future<void> crearVentanilla(String token, {required String nombre, required int colaId});

  Future<void> editarVentanilla(String token, int id, {String? nombre, bool? activa});

  Future<WhatsAppNegocio> whatsapp(String token);

  /// [accion]: `numero` (con [telefono]), `codigo`, `prueba` (con [telefono]) o `desvincular`.
  Future<WhatsAppNegocio> accionWhatsapp(String token, String accion, {String? telefono});
}

/// Dónde se guarda la sesión del personal en el teléfono (almacén cifrado).
abstract interface class AlmacenPersonal {
  Future<SesionPersonal?> leerPersonal();

  Future<void> guardarPersonal(SesionPersonal sesion);

  Future<void> borrarPersonal();
}
