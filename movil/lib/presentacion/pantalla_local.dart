import 'package:flutter/material.dart';
import 'tema.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_reservar_cita.dart';
import 'pantalla_acceso.dart';

/// Servicios del local con su espera en vivo: el cliente elige uno y toma su turno (canal APP). Devuelve el turno
/// creado. Abierto desde «Mis locales» (sin la marca del QR) sirve para mirar la espera y las mejores horas.
class PantallaLocal extends StatefulWidget {
  const PantallaLocal({super.key, required this.local});

  final Local local;

  @override
  State<PantallaLocal> createState() => _PantallaLocalState();
}

class _PantallaLocalState extends State<PantallaLocal> {
  final _nombre = TextEditingController();
  late Local _local = widget.local;
  int? _enCurso;
  String? _error;
  Cuenta? _cuenta;
  String? _categoria;
  var _favorito = false;
  var _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    final dependencias = Dependencias.de(context);
    _cuenta = dependencias.sesion.cuenta;
    dependencias.misLocales().then((lista) {
      if (mounted) setState(() => _favorito = lista.any((l) => l.slug == _local.slug && l.favorito));
    });
  }

  /// Vuelve a pedir la espera de las colas (conserva la marca del QR con que se abrió).
  Future<void> _refrescar() async {
    try {
      final nuevo = await Dependencias.de(context).abrirLocal.desdeQr(_local.slug);
      if (mounted) setState(() => _local = nuevo.conPresencia(widget.local.presencia));
    } on ErrorTurno catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    }
  }

  Future<void> _alternarFavorito() async {
    await Dependencias.de(context).misLocales.alternarFavorito(_local.slug);
    if (!mounted) return;
    setState(() => _favorito = !_favorito);
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_favorito ? 'Agregado a tus locales favoritos' : 'Quitado de favoritos'), duration: const Duration(seconds: 2)));
  }

  /// Crear cuenta o ingresar (correo, o celular por WhatsApp de este local). Devuelve si quedó con cuenta.
  Future<bool> _ingresar({String? motivo}) async {
    final cuenta = await Navigator.of(context).push<Cuenta>(
        MaterialPageRoute(builder: (_) => PantallaAcceso(slug: _local.slug, nombreLocal: _local.nombre, motivo: motivo)));
    if (cuenta != null && mounted) setState(() => _cuenta = cuenta);
    return cuenta != null;
  }

  Future<void> _tomar(Cola cola) async {
    setState(() {
      _enCurso = cola.id;
      _error = null;
    });
    try {
      final turno = await Dependencias.de(context).tomarTurno(local: _local, colaId: cola.id, nombre: _nombre.text, categoria: _categoria);
      if (mounted) Navigator.of(context).pop(turno);
    } on ErrorTurno catch (e) {
      setState(() => _error = _explicar(e));
    } finally {
      if (mounted) setState(() => _enCurso = null);
    }
  }

  /// Mensaje del servidor; si el teléfono está bloqueado por faltas, también hasta cuándo.
  static String _explicar(ErrorTurno e) {
    final hasta = DateTime.tryParse(e.datos['hasta'] as String? ?? '')?.toLocal();
    if (e.codigo != 'APP_BLOQUEADO_FALTAS' || hasta == null) return e.mensaje;
    String dos(int n) => n.toString().padLeft(2, '0');
    return '${e.mensaje}\nPodrás volver a usar la app desde el ${dos(hasta.day)}/${dos(hasta.month)} a las ${dos(hasta.hour)}:${dos(hasta.minute)}.';
  }

  /// Las mejores horas son para clientes con cuenta.
  Future<void> _verMejoresHoras(Cola cola) async {
    if (_cuenta == null && !await _ingresar(motivo: 'Las mejores horas para ir son para clientes con cuenta. Créala gratis.')) return;
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => _MejoresHoras(cola: cola, color: colorDesdeHex(_local.colorPrimario)),
    );
  }

  @override
  void dispose() {
    _nombre.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final local = _local;
    final color = colorDesdeHex(local.colorPrimario);
    final tema = Theme.of(context);
    final elegida = local.categorias.where((c) => c.codigo == _categoria).firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: Text(local.nombre),
        backgroundColor: color,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Reservar cita',
            icon: const Icon(Icons.event_available),
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute<void>(builder: (_) => PantallaReservarCita(slug: local.slug, nombreLocal: local.nombre))),
          ),
          IconButton(
            tooltip: _favorito ? 'Quitar de favoritos' : 'Agregar a favoritos',
            icon: Icon(_favorito ? Icons.star : Icons.star_border),
            onPressed: _alternarFavorito,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refrescar,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (local.direccion != null)
              Row(children: [
                const Icon(Icons.place_outlined, size: 18),
                const SizedBox(width: 4),
                Expanded(child: Text(local.direccion!, style: tema.textTheme.bodyMedium)),
              ]),
            if (!local.abierto)
              AvisoTarjeta(tono: TonoAviso.alerta, icono: Icons.schedule, titulo: local.mensajeCerrado ?? 'El local está cerrado ahora.'),
            if (local.presencia == null)
              Card(
                color: ColoresTurnoYa.infoFondo,
                child: const ListTile(
                  leading: Icon(Icons.qr_code_2),
                  title: Text('Escanea el QR para tomar turno'),
                  subtitle: Text('Aquí ves la espera en vivo. Para tomar turno escanea el QR «App» de la pantalla del local: '
                      'así comprobamos que estás allí.'),
                ),
              ),
            const SizedBox(height: 12),
            if (_cuenta != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(child: Icon(Icons.person)),
                title: Text(_cuenta!.nombre ?? 'Tu cuenta'),
                subtitle: Text('El turno quedará a tu nombre · ${_cuenta!.identificador}'),
              )
            else ...[
              TextField(
                controller: _nombre,
                maxLength: 60,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Tu nombre (opcional)', border: OutlineInputBorder()),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _enCurso == null ? () => _ingresar() : null,
                  icon: const Icon(Icons.person_add_alt),
                  label: const Text('Crear cuenta o ingresar (guarda tus turnos)'),
                ),
              ),
            ],
            if (local.categorias.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Atención preferencial', style: tema.textTheme.titleMedium),
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  ChoiceChip(label: const Text('No'), selected: _categoria == null, onSelected: (_) => setState(() => _categoria = null)),
                  for (final c in local.categorias)
                    ChoiceChip(
                      label: Text(c.nombre),
                      selected: _categoria == c.codigo,
                      onSelected: (sel) => setState(() => _categoria = sel ? c.codigo : null),
                    ),
                ],
              ),
              if (elegida != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    elegida.documentoLegible == null
                        ? 'En la ventanilla verificarán que te corresponde.'
                        : 'Lleva tu ${elegida.documentoLegible}: te lo pedirán en la ventanilla.',
                    style: tema.textTheme.bodySmall,
                  ),
                ),
            ],
            const SizedBox(height: 16),
            Text('¿Qué servicio necesitas?', style: tema.textTheme.titleLarge),
            const SizedBox(height: 8),
            if (local.colas.isEmpty) const Text('Este local no tiene servicios disponibles por el momento.'),
            for (final cola in local.colas)
              Card(
                child: Column(
                  children: [
                    ListTile(
                      enabled: _enCurso == null,
                      leading: CircleAvatar(backgroundColor: color, foregroundColor: Colors.white, child: Text(cola.prefijo)),
                      title: Text(cola.nombre),
                      subtitle: Text(cola.enEspera == 0 ? 'Sin espera' : '${cola.enEspera} en espera · ~${cola.minutosEstimados} min'),
                      trailing: _enCurso == cola.id
                          ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                          : Icon(local.presencia == null ? Icons.lock_outline : Icons.arrow_forward),
                      onTap: () => _tomar(cola),
                    ),
                    if (local.conPrediccion)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () => _verMejoresHoras(cola),
                          icon: Icon(_cuenta == null ? Icons.lock_outline : Icons.insights, size: 18),
                          label: const Text('Mejores horas para ir'),
                        ),
                      ),
                  ],
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!, style: TextStyle(color: tema.colorScheme.error)),
              ),
          ],
        ),
      ),
    );
  }
}

/// Espera típica de cada media hora de lo que queda del día.
class _MejoresHoras extends StatefulWidget {
  const _MejoresHoras({required this.cola, required this.color});

  final Cola cola;
  final Color color;

  @override
  State<_MejoresHoras> createState() => _MejoresHorasState();
}

class _MejoresHorasState extends State<_MejoresHoras> {
  Future<List<FranjaEspera>>? _franjas;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _franjas ??= Dependencias.de(context).mejoresHoras(widget.cola.id);
  }

  static Color _colorNivel(String nivel) => switch (nivel) {
        'baja' => ColoresTurnoYa.exito,
        'alta' => ColoresTurnoYa.peligro,
        _ => ColoresTurnoYa.alerta,
      };

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: FutureBuilder<List<FranjaEspera>>(
          future: _franjas,
          builder: (context, estado) {
            final cabecera = Text('Mejores horas hoy · ${widget.cola.nombre}', style: tema.textTheme.titleMedium);
            if (estado.connectionState != ConnectionState.done) {
              return Column(mainAxisSize: MainAxisSize.min, children: [cabecera, const Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())]);
            }
            final franjas = estado.data ?? const [];
            if (estado.hasError || franjas.isEmpty) {
              return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                cabecera,
                const SizedBox(height: 12),
                Text(estado.hasError
                    ? 'No se pudo consultar ahora.'
                    : 'Por hoy no hay más horas que recomendar: ya pasaron o todavía falta historia de este servicio. '
                        'Vuelve a mirar mañana temprano.'),
              ]);
            }
            final minima = franjas.map((f) => f.esperaMin).reduce((a, b) => a < b ? a : b);
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                cabecera,
                const SizedBox(height: 4),
                Text('Espera típica de las últimas semanas para lo que queda del día.', style: tema.textTheme.bodySmall),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final f in franjas)
                        ListTile(
                          dense: true,
                          leading: Icon(Icons.circle, size: 14, color: _colorNivel(f.nivel)),
                          title: Text(f.franja, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text('Espera ${f.nivel}'),
                          trailing: Text(f.esperaMin == minima ? '~${f.esperaMin} min · mejor' : '~${f.esperaMin} min'),
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
