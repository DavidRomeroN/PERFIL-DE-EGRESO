import 'dart:async';

import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import '../dominio/personal.dart';
import 'dependencias.dart';
import 'pantalla_admin_negocio.dart';
import 'tema.dart';

/// Entrada del personal del negocio: ingreso con la cuenta del negocio y, después, el panel. El operador ve solo sus
/// ventanillas (si tiene una sola, entra directo a ella); el admin además administra colas, ventanillas y WhatsApp; la
/// recepción (kiosco) emite tickets en cualquier cola y ve a todos los que esperan.
class PantallaNegocio extends StatefulWidget {
  const PantallaNegocio({super.key, required this.alSalir});

  /// Volver a la app del cliente.
  final VoidCallback alSalir;

  @override
  State<PantallaNegocio> createState() => _PantallaNegocioState();
}

class _PantallaNegocioState extends State<PantallaNegocio> {
  SesionPersonal? _sesion;
  var _cargando = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_cargando) {
      Dependencias.de(context).personal.sesion().then((s) {
        if (mounted) {
          setState(() {
            _sesion = s;
            _cargando = false;
          });
        }
      });
    }
  }

  Future<void> _salir() async {
    await Dependencias.de(context).personal.salir();
    if (mounted) setState(() => _sesion = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final sesion = _sesion;
    if (sesion == null) {
      return _IngresoNegocio(alIngresar: (s) => setState(() => _sesion = s), alVolver: widget.alSalir);
    }
    return _PanelNegocio(sesion: sesion, alCerrarSesion: _salir, alVolverCliente: widget.alSalir);
  }
}

class _IngresoNegocio extends StatefulWidget {
  const _IngresoNegocio({required this.alIngresar, required this.alVolver});

  final ValueChanged<SesionPersonal> alIngresar;
  final VoidCallback alVolver;

  @override
  State<_IngresoNegocio> createState() => _IngresoNegocioState();
}

class _IngresoNegocioState extends State<_IngresoNegocio> {
  final _correo = TextEditingController();
  final _clave = TextEditingController();
  var _enviando = false;
  String? _error;

  @override
  void dispose() {
    _correo.dispose();
    _clave.dispose();
    super.dispose();
  }

  Future<void> _ingresar() async {
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      final s = await Dependencias.de(context).personal.ingresar(_correo.text, _clave.text);
      widget.alIngresar(s);
    } on ErrorTurno catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi negocio'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), tooltip: 'Volver', onPressed: widget.alVolver),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Invitacion(
            icono: Icons.storefront,
            titulo: 'Atiende desde tu celular',
            texto: 'Ingresa con la cuenta de tu negocio (la misma de la web) para llamar a tus clientes y emitir tickets.',
          ),
          if (_error != null)
            Card(
              color: Theme.of(context).colorScheme.errorContainer,
              child: ListTile(leading: const Icon(Icons.error_outline), title: Text(_error!)),
            ),
          TextField(
            controller: _correo,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Correo', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _clave,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Contraseña', border: OutlineInputBorder()),
            onSubmitted: (_) => _ingresar(),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _enviando ? null : _ingresar, child: Text(_enviando ? 'Ingresando…' : 'Ingresar')),
        ],
      ),
    );
  }
}

/// Panel del personal. Admin: pestañas Atender, Colas, Ventanillas y WhatsApp. Operador: solo Atender.
class _PanelNegocio extends StatefulWidget {
  const _PanelNegocio({required this.sesion, required this.alCerrarSesion, required this.alVolverCliente});

  final SesionPersonal sesion;
  final VoidCallback alCerrarSesion;
  final VoidCallback alVolverCliente;

  @override
  State<_PanelNegocio> createState() => _PanelNegocioState();
}

class _PanelNegocioState extends State<_PanelNegocio> {
  var _pestana = 0;

  Future<void> _menu(String opcion) async {
    if (opcion == 'salir') {
      widget.alCerrarSesion();
    } else {
      widget.alVolverCliente();
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = widget.sesion.esAdmin;
    final Widget cuerpo = widget.sesion.esKiosco
        ? _Recepcion(alSesionVencida: widget.alCerrarSesion)
        : switch (_pestana) {
            1 => const VistaColas(),
            2 => const VistaVentanillas(),
            3 => const VistaWhatsApp(),
            _ => _Atender(alSesionVencida: widget.alCerrarSesion),
          };
    final rolVisible = admin
        ? 'Administrador'
        : widget.sesion.esKiosco
            ? 'Recepción'
            : 'Operador';
    const titulos = ['Atender', 'Colas', 'Ventanillas', 'WhatsApp'];
    return Scaffold(
      appBar: AppBar(
        title: Text(_pestana == 0 ? widget.sesion.local : titulos[_pestana]),
        actions: [
          PopupMenuButton<String>(
            onSelected: _menu,
            itemBuilder: (_) => [
              PopupMenuItem(enabled: false, child: Text('${widget.sesion.nombre} · $rolVisible')),
              const PopupMenuItem(value: 'cliente', child: Text('Ir a la app del cliente')),
              const PopupMenuItem(value: 'salir', child: Text('Cerrar sesión del negocio')),
            ],
          ),
        ],
      ),
      body: KeyedSubtree(key: ValueKey(_pestana), child: cuerpo),
      bottomNavigationBar: admin
          ? NavigationBar(
              selectedIndex: _pestana,
              onDestinationSelected: (i) => setState(() => _pestana = i),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.campaign_outlined), selectedIcon: Icon(Icons.campaign), label: 'Atender'),
                NavigationDestination(icon: Icon(Icons.format_list_numbered), label: 'Colas'),
                NavigationDestination(icon: Icon(Icons.point_of_sale_outlined), selectedIcon: Icon(Icons.point_of_sale), label: 'Ventanillas'),
                NavigationDestination(icon: Icon(Icons.chat_outlined), selectedIcon: Icon(Icons.chat), label: 'WhatsApp'),
              ],
            )
          : null,
    );
  }
}

/// Las ventanillas del usuario: con una sola, su vista directa; con varias, la lista para elegir.
class _Atender extends StatefulWidget {
  const _Atender({required this.alSesionVencida});

  final VoidCallback alSesionVencida;

  @override
  State<_Atender> createState() => _AtenderState();
}

class _AtenderState extends State<_Atender> {
  PanelPersonal? _panel;
  String? _error;
  int? _elegida;
  Timer? _reloj;
  StreamSubscription<void>? _vivo;
  var _ocupado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_panel == null && _error == null) {
      _cargar();
      _reloj ??= Timer.periodic(const Duration(seconds: 15), (_) => _cargar());
    }
  }

  @override
  void dispose() {
    _reloj?.cancel();
    _vivo?.cancel();
    super.dispose();
  }

  Future<void> _cargar() async {
    try {
      final p = await Dependencias.de(context).personal.panel();
      if (!mounted) return;
      // Canal en vivo del local: se refresca apenas alguien saca turno
      _vivo ??= Dependencias.de(context).seguirTurno.cambiosDe(p.slug).listen((_) => _cargar());
      setState(() {
        _panel = p;
        _error = null;
      });
    } on ErrorTurno catch (e) {
      if (!mounted) return;
      if (e.codigo == 'NO_AUTENTICADO') {
        widget.alSesionVencida();
        return;
      }
      setState(() => _error = e.mensaje);
    }
  }

  void _avisar(String texto) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  Future<void> _hacer(Future<void> Function() accion, {String? exito}) async {
    if (_ocupado) return;
    setState(() => _ocupado = true);
    try {
      await accion();
      if (exito != null) _avisar(exito);
    } on ErrorTurno catch (e) {
      if (e.codigo == 'NO_AUTENTICADO') {
        widget.alSesionVencida();
        return;
      }
      _avisar(e.mensaje);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
    await _cargar();
  }

  Future<void> _llamar(VentanillaPersonal v) => _hacer(() async {
        final t = await Dependencias.de(context).personal.llamarSiguiente(v.id);
        _avisar(t == null ? 'No hay nadie esperando en ${v.cola}' : 'Llamaste a ${t.codigo}');
      });

  Future<void> _ticket(List<ColaTicket> colas, {int? colaId}) async {
    final emitido = await showModalBottomSheet<TicketEmitido>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _HojaTicket(colas: colas, colaInicial: colaId ?? colas.first.id),
    );
    if (emitido != null) {
      _avisar('Ticket ${emitido.codigo} emitido');
      await _cargar();
    }
  }

  @override
  Widget build(BuildContext context) {
    final panel = _panel;
    if (panel == null) {
      return _error == null
          ? const Center(child: CircularProgressIndicator())
          : Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: _error!, accion: 'Reintentar', alPulsar: _cargar);
    }
    if (panel.ventanillas.isEmpty) {
      return Invitacion(
        icono: Icons.point_of_sale,
        titulo: 'Sin ventanillas',
        texto: panel.esAdmin
            ? 'Crea una cola en la pestaña «Colas»: su ventanilla se crea sola.'
            : 'El administrador aún no te asignó una ventanilla.',
      );
    }
    final unica = panel.ventanillas.length == 1;
    final elegida = unica ? panel.ventanillas.first : panel.ventanillas.where((v) => v.id == _elegida).firstOrNull;
    if (elegida != null) {
      return PopScope(
        canPop: unica,
        onPopInvokedWithResult: (hecho, _) {
          if (!hecho) setState(() => _elegida = null);
        },
        child: _VistaVentanilla(
          ventanilla: elegida,
          ocupado: _ocupado,
          alVolver: unica ? null : () => setState(() => _elegida = null),
          alLlamar: () => _llamar(elegida),
          alAtender: (t) => _hacer(() => Dependencias.de(context).personal.atendido(t.id), exito: '${t.codigo} atendido'),
          alNoVino: (t) => _hacer(() => Dependencias.de(context).personal.noSePresento(t.id), exito: '${t.codigo}: no se presentó'),
          alRellamar: (t) => _hacer(() => Dependencias.de(context).personal.volverALlamar(t.id), exito: 'Volviste a llamar a ${t.codigo}'),
          alTicket: () => _ticket([ColaTicket(id: elegida.colaId, nombre: elegida.cola, prefijo: elegida.prefijo)]),
        ),
      );
    }
    final enEspera = panel.colasTicket.isEmpty
        ? 0
        : {for (final v in panel.ventanillas) v.colaId: v.enEspera}.values.fold<int>(0, (a, b) => a + b);
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            Expanded(
              child: Text(panel.esAdmin ? 'Todas las ventanillas' : 'Tus ventanillas', style: Theme.of(context).textTheme.titleMedium),
            ),
            Text(enEspera == 1 ? '1 en espera' : '$enEspera en espera', style: Theme.of(context).textTheme.bodySmall),
          ]),
          const SizedBox(height: 8),
          LayoutBuilder(builder: (context, medidas) {
            final columnas = medidas.maxWidth >= 600 ? 2 : 1;
            final ancho = (medidas.maxWidth - (columnas - 1) * 8) / columnas;
            return Wrap(spacing: 8, runSpacing: 8, children: [
              for (final v in panel.ventanillas)
                SizedBox(
                  width: ancho,
                  child: _TarjetaVentanilla(
                    ventanilla: v,
                    ocupado: _ocupado,
                    alLlamar: () => _llamar(v),
                    alVer: () => setState(() => _elegida = v.id),
                  ),
                ),
            ]);
          }),
          const SizedBox(height: 12),
          if (panel.colasTicket.isNotEmpty)
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52)),
              onPressed: () => _ticket(panel.colasTicket),
              icon: const Icon(Icons.confirmation_number_outlined),
              label: const Text('Emitir ticket'),
            ),
        ],
      ),
    );
  }
}

/// Una ventanilla en la lista: quién está en atención, el botón para llamar al siguiente y quiénes siguen (como en la web).
class _TarjetaVentanilla extends StatelessWidget {
  const _TarjetaVentanilla({required this.ventanilla, required this.ocupado, required this.alLlamar, required this.alVer});

  final VentanillaPersonal ventanilla;
  final bool ocupado;
  final VoidCallback alLlamar;
  final VoidCallback alVer;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final v = ventanilla;
    final siguiente = v.siguientes.firstOrNull;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(v.nombre, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                Text(v.cola, style: tema.textTheme.bodySmall),
              ]),
            ),
            TextButton(onPressed: alVer, child: const Text('Ver')),
          ]),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: v.actual == null
                ? Text('Libre', style: tema.textTheme.titleMedium?.copyWith(color: tema.colorScheme.onSurfaceVariant))
                : Text.rich(TextSpan(children: [
                    TextSpan(text: v.actual!.codigo, style: tema.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                    if (v.actual!.nombre != null) TextSpan(text: '  ${v.actual!.nombre}', style: tema.textTheme.bodyMedium),
                  ])),
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: ocupado || siguiente == null ? null : alLlamar,
              icon: const Icon(Icons.campaign),
              label: Text(siguiente == null ? 'Llamar siguiente' : 'Llamar siguiente  ${siguiente.codigo}'),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            v.siguientes.isEmpty ? 'Nadie en espera' : 'Siguen: ${v.siguientes.take(3).map((t) => t.codigo).join('  ')}',
            textAlign: TextAlign.center,
            style: tema.textTheme.bodySmall,
          ),
        ]),
      ),
    );
  }
}

class _VistaVentanilla extends StatelessWidget {
  const _VistaVentanilla({
    required this.ventanilla,
    required this.ocupado,
    required this.alLlamar,
    required this.alAtender,
    required this.alNoVino,
    required this.alRellamar,
    required this.alTicket,
    this.alVolver,
  });

  final VentanillaPersonal ventanilla;
  final bool ocupado;
  final VoidCallback alLlamar;
  final ValueChanged<TurnoPersonal> alAtender;
  final ValueChanged<TurnoPersonal> alNoVino;
  final ValueChanged<TurnoPersonal> alRellamar;
  final VoidCallback alTicket;
  final VoidCallback? alVolver;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final actual = ventanilla.actual;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(children: [
          if (alVolver != null) IconButton(icon: const Icon(Icons.arrow_back), tooltip: 'Mis ventanillas', onPressed: alVolver),
          Expanded(
            child: Text('${ventanilla.nombre} · ${ventanilla.cola}', style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          ),
        ]),
        const SizedBox(height: 8),
        // El turno en atención, en la tarjeta de la marca (mismo degradado que el inicio de la app)
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [ColoresTurnoYa.primario, ColoresTurnoYa.primarioOscuro],
            ),
          ),
          child: Column(children: [
            Text(actual == null ? 'Nadie en atención' : 'Atendiendo',
                style: tema.textTheme.titleSmall?.copyWith(color: Colors.white70, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(actual?.codigo ?? '—', style: tema.textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w800, color: Colors.white)),
            if (actual?.nombre != null) Text(actual!.nombre!, style: tema.textTheme.titleMedium?.copyWith(color: Colors.white)),
            if (actual != null && actual.rellamadas > 0)
              Text('Llamado ${actual.rellamadas + 1} veces', style: tema.textTheme.bodySmall?.copyWith(color: Colors.white70)),
          ]),
        ),
        const SizedBox(height: 12),
        if (actual != null) ...[
          Row(children: [
            Expanded(
              child: FilledButton.tonalIcon(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 52)),
                onPressed: ocupado ? null : () => alAtender(actual),
                icon: const Icon(Icons.check),
                label: const Text('Atendido'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 52)),
                onPressed: ocupado ? null : () => alNoVino(actual),
                icon: const Icon(Icons.person_off_outlined),
                label: const Text('No vino'),
              ),
            ),
          ]),
          TextButton.icon(onPressed: ocupado ? null : () => alRellamar(actual), icon: const Icon(Icons.replay), label: const Text('Volver a llamar')),
        ],
        FilledButton.icon(
          onPressed: ocupado || ventanilla.enEspera == 0 ? null : alLlamar,
          icon: const Icon(Icons.campaign),
          label: Text(ventanilla.enEspera == 0
              ? 'Nadie esperando'
              : ventanilla.siguientes.isEmpty
                  ? 'Llamar al siguiente'
                  : 'Llamar al siguiente  ${ventanilla.siguientes.first.codigo}'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: alTicket, icon: const Icon(Icons.confirmation_number_outlined), label: const Text('Emitir ticket para un cliente')),
        const SizedBox(height: 16),
        Text(ventanilla.enEspera == 1 ? '1 persona espera' : '${ventanilla.enEspera} personas esperan', style: tema.textTheme.titleMedium),
        for (final t in ventanilla.siguientes)
          ListTile(
            dense: true,
            leading: Text(t.codigo, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            title: Text(t.nombre ?? 'Sin nombre'),
            subtitle: Text([_canal(t.canal), if (t.categoria != null) t.categoria!].join(' · ')),
          ),
      ],
    );
  }

  static String _canal(String canal) => switch (canal) {
        'APP' => 'App',
        'WHATSAPP' => 'WhatsApp',
        'TICKET' => 'Ticket',
        'CITA' => 'Cita',
        'KIOSCO' => 'Kiosco',
        _ => 'QR',
      };
}

/// Ticket para un cliente sin la app: con su celular le llegan el número y el llamado por WhatsApp.
class _HojaTicket extends StatefulWidget {
  const _HojaTicket({required this.colas, required this.colaInicial, this.recepcion = false});

  final List<ColaTicket> colas;
  final int colaInicial;

  /// Lo emite la recepción (kiosco).
  final bool recepcion;

  @override
  State<_HojaTicket> createState() => _HojaTicketState();
}

class _HojaTicketState extends State<_HojaTicket> {
  late int _cola = widget.colaInicial;
  final _nombre = TextEditingController();
  final _telefono = TextEditingController();
  var _acepta = false;
  var _enviando = false;
  String? _error;

  @override
  void dispose() {
    _nombre.dispose();
    _telefono.dispose();
    super.dispose();
  }

  Future<void> _emitir() async {
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      final t = await Dependencias.de(context)
          .personal
          .ticket(colaId: _cola, nombre: _nombre.text, telefono: _telefono.text, consentimiento: _acepta, recepcion: widget.recepcion);
      if (mounted) Navigator.of(context).pop(t);
    } on ErrorTurno catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Emitir ticket', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 4),
          const Text('Con su celular, el cliente recibe por WhatsApp su número y el aviso cuando lo llames. No necesita la app.'),
          const SizedBox(height: 12),
          if (widget.colas.length > 1)
            DropdownButtonFormField<int>(
              initialValue: _cola,
              decoration: const InputDecoration(labelText: 'Cola', border: OutlineInputBorder()),
              items: [for (final c in widget.colas) DropdownMenuItem(value: c.id, child: Text(c.nombre))],
              onChanged: (v) => setState(() => _cola = v ?? _cola),
            ),
          if (widget.colas.length > 1) const SizedBox(height: 12),
          TextField(
            controller: _nombre,
            maxLength: 60,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Nombre (opcional)', border: OutlineInputBorder()),
          ),
          TextField(
            controller: _telefono,
            keyboardType: TextInputType.phone,
            maxLength: 15,
            decoration: const InputDecoration(labelText: 'Celular para WhatsApp (opcional)', hintText: '951234567', border: OutlineInputBorder()),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _acepta,
            onChanged: (v) => setState(() => _acepta = v ?? false),
            title: const Text('El cliente acepta que le escribamos por WhatsApp solo por este turno'),
          ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          const SizedBox(height: 8),
          FilledButton(onPressed: _enviando ? null : _emitir, child: Text(_enviando ? 'Emitiendo…' : 'Emitir ticket')),
        ],
      ),
    );
  }
}

/// La recepción (rol kiosco), como `/panel-kiosco` en la web: toca la cola del cliente para emitir su ticket y mira a
/// todos los que esperan; si el plan lo permite, pasa a un cliente a otra cola sin que pierda su lugar.
class _Recepcion extends StatefulWidget {
  const _Recepcion({required this.alSesionVencida});

  final VoidCallback alSesionVencida;

  @override
  State<_Recepcion> createState() => _RecepcionState();
}

class _RecepcionState extends State<_Recepcion> {
  PanelKiosco? _panel;
  String? _error;
  Timer? _reloj;
  StreamSubscription<void>? _vivo;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_panel == null && _error == null) {
      _cargar();
      _reloj ??= Timer.periodic(const Duration(seconds: 15), (_) => _cargar());
    }
  }

  @override
  void dispose() {
    _reloj?.cancel();
    _vivo?.cancel();
    super.dispose();
  }

  Future<void> _cargar() async {
    try {
      final p = await Dependencias.de(context).personal.panelKiosco();
      if (!mounted) return;
      _vivo ??= Dependencias.de(context).seguirTurno.cambiosDe(p.slug).listen((_) => _cargar());
      setState(() {
        _panel = p;
        _error = null;
      });
    } on ErrorTurno catch (e) {
      if (!mounted) return;
      if (e.codigo == 'NO_AUTENTICADO') {
        widget.alSesionVencida();
        return;
      }
      setState(() => _error = e.mensaje);
    }
  }

  void _avisar(String texto) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  Future<void> _ticket(ColaKiosco cola) async {
    final emitido = await showModalBottomSheet<TicketEmitido>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _HojaTicket(
        colas: [ColaTicket(id: cola.id, nombre: cola.nombre, prefijo: cola.prefijo)],
        colaInicial: cola.id,
        recepcion: true,
      ),
    );
    if (emitido != null) {
      _avisar('Ticket ${emitido.codigo} emitido');
      await _cargar();
    }
  }

  Future<void> _transferir(EsperaKiosco turno, List<ColaKiosco> colas) async {
    final destino = await showDialog<ColaKiosco>(
      context: context,
      builder: (contexto) => SimpleDialog(
        title: Text('Pasar ${turno.codigo} a otra cola'),
        children: [
          for (final c in colas.where((c) => c.id != turno.colaId))
            SimpleDialogOption(
              onPressed: () => Navigator.of(contexto).pop(c),
              child: Text('${c.prefijo} · ${c.nombre}'),
            ),
        ],
      ),
    );
    if (destino == null || !mounted) return;
    try {
      final codigo = await Dependencias.de(context).personal.transferir(turno.id, destino.id);
      _avisar('Cliente transferido: ahora es $codigo y conserva su lugar');
    } on ErrorTurno catch (e) {
      if (e.codigo == 'NO_AUTENTICADO') {
        widget.alSesionVencida();
        return;
      }
      _avisar(e.mensaje);
    }
    await _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final panel = _panel;
    if (panel == null) {
      return _error == null
          ? const Center(child: CircularProgressIndicator())
          : Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: _error!, accion: 'Reintentar', alPulsar: _cargar);
    }
    final tema = Theme.of(context);
    final ahora = DateTime.now();
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Emitir ticket', style: tema.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          Text(
            panel.whatsapp
                ? 'Toca la cola del cliente. Si deja su celular, le llegan su número y el llamado por WhatsApp.'
                : 'Toca la cola del cliente para emitir su ticket.',
            style: tema.textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          if (panel.colas.isEmpty)
            const Text('El local aún no tiene colas activas.')
          else
            LayoutBuilder(builder: (context, medidas) {
              final columnas = medidas.maxWidth >= 600 ? 3 : 2;
              final ancho = (medidas.maxWidth - (columnas - 1) * 8) / columnas;
              return Wrap(spacing: 8, runSpacing: 8, children: [
                for (final c in panel.colas)
                  SizedBox(
                    width: ancho,
                    child: Card(
                      margin: EdgeInsets.zero,
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: () => _ticket(c),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            CircleAvatar(
                              backgroundColor: tema.colorScheme.primary,
                              foregroundColor: tema.colorScheme.onPrimary,
                              child: Text(c.prefijo, style: const TextStyle(fontWeight: FontWeight.w800)),
                            ),
                            const SizedBox(height: 8),
                            Text(c.nombre, style: tema.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700), maxLines: 2),
                            Text(
                              c.enEspera == 0
                                  ? 'Nadie en espera'
                                  : '${c.enEspera} en espera${c.tiempoEstimadoSeg > 0 ? ' · ~${(c.tiempoEstimadoSeg / 60).ceil()} min' : ''}',
                              style: tema.textTheme.bodySmall,
                            ),
                          ]),
                        ),
                      ),
                    ),
                  ),
              ]);
            }),
          const SizedBox(height: 20),
          Text('Clientes en espera', style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          Text(panel.espera.length == 1 ? '1 en todas las colas' : '${panel.espera.length} en todas las colas', style: tema.textTheme.bodySmall),
          const SizedBox(height: 8),
          if (panel.espera.isEmpty)
            const Card(child: ListTile(leading: Icon(Icons.check_circle_outline), title: Text('Nadie está esperando')))
          else
            Card(
              child: Column(children: [
                for (final t in panel.espera)
                  ListTile(
                    leading: Text(t.codigo, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                    title: Text(t.nombre ?? 'Sin nombre'),
                    subtitle: Text('${t.prefijo} · ${t.cola} · ${_VistaVentanilla._canal(t.canal)} · '
                        '${t.emitidoAt.hour.toString().padLeft(2, '0')}:${t.emitidoAt.minute.toString().padLeft(2, '0')}'),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text('${ahora.difference(t.emitidoAt).inMinutes.clamp(0, 9999)} min', style: tema.textTheme.bodySmall),
                      if (panel.puedeTransferir)
                        InkWell(
                          onTap: () => _transferir(t, panel.colas),
                          child: Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text('Transferir', style: tema.textTheme.labelMedium?.copyWith(color: tema.colorScheme.primary)),
                          ),
                        ),
                    ]),
                  ),
              ]),
            ),
        ],
      ),
    );
  }
}
