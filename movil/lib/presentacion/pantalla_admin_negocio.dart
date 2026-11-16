import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import '../dominio/personal.dart';
import 'dependencias.dart';
import 'tema.dart';

/// Lo único de la administración que va en la app: colas, ventanillas y el WhatsApp del negocio. El resto (usuarios,
/// horario, módulos, plan…) sigue en la web.

void _avisar(BuildContext context, String texto) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));

/// Pide un texto (o dos) en un diálogo. Devuelve `null` si se canceló.
Future<List<String>?> _pedirTextos(BuildContext context, String titulo, List<(String, String, int)> campos) {
  final controles = [for (final c in campos) TextEditingController(text: c.$2)];
  return showDialog<List<String>>(
    context: context,
    builder: (contexto) => AlertDialog(
      title: Text(titulo),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 0; i < campos.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: TextField(
              controller: controles[i],
              autofocus: i == 0,
              maxLength: campos[i].$3,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(labelText: campos[i].$1, border: const OutlineInputBorder()),
            ),
          ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.of(contexto).pop(), child: const Text('Cancelar')),
        FilledButton(onPressed: () => Navigator.of(contexto).pop([for (final c in controles) c.text]), child: const Text('Guardar')),
      ],
    ),
  );
}

// ── Colas ──

class VistaColas extends StatefulWidget {
  const VistaColas({super.key});

  @override
  State<VistaColas> createState() => _VistaColasState();
}

class _VistaColasState extends State<VistaColas> {
  Future<List<ColaNegocio>>? _colas;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _colas ??= Dependencias.de(context).personal.colas();
  }

  void _recargar() => setState(() => _colas = Dependencias.de(context).personal.colas());

  Future<void> _hacer(Future<void> Function() accion, String exito) async {
    try {
      await accion();
      if (mounted) _avisar(context, exito);
    } on ErrorTurno catch (e) {
      if (mounted) _avisar(context, e.mensaje);
    }
    if (mounted) _recargar();
  }

  Future<void> _crear() async {
    final datos = await _pedirTextos(context, 'Nueva cola', [('Nombre (ej. Cortes, Dra. Ríos)', '', 60), ('Letra del ticket (ej. A)', '', 3)]);
    if (datos == null || !mounted) return;
    await _hacer(() => Dependencias.de(context).personal.crearCola(nombre: datos[0], prefijo: datos[1]),
        'Cola creada con su ventanilla');
  }

  Future<void> _eliminar(ColaNegocio c) async {
    final si = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: Text('¿Eliminar «${c.nombre}»?'),
        content: const Text('También se desactiva su ventanilla. Los turnos de hoy se conservan en el historial.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(contexto).pop(false), child: const Text('No')),
          FilledButton(onPressed: () => Navigator.of(contexto).pop(true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (si == true && mounted) await _hacer(() => Dependencias.de(context).personal.eliminarCola(c.id), 'Cola eliminada');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(onPressed: _crear, icon: const Icon(Icons.add), label: const Text('Nueva cola')),
      body: FutureBuilder<List<ColaNegocio>>(
        future: _colas,
        builder: (context, estado) {
          if (estado.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (estado.hasError) {
            final e = estado.error;
            return Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: e is ErrorTurno ? e.mensaje : 'Revisa tu conexión.',
                accion: 'Reintentar', alPulsar: _recargar);
          }
          final colas = estado.data ?? const [];
          if (colas.isEmpty) {
            return const Invitacion(icono: Icons.format_list_numbered, titulo: 'Sin colas', texto: 'Crea tu primera cola: cada una trae su ventanilla.');
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              const Text('Cada cola tiene su ventanilla. Tu plan define cuántas puedes tener.'),
              const SizedBox(height: 8),
              for (final c in colas)
                Card(
                  child: ListTile(
                    leading: CircleAvatar(child: Text(c.prefijo)),
                    title: Text(c.nombre),
                    subtitle: Text(c.ventanillas.isEmpty ? 'Sin ventanilla' : c.ventanillas.join(', ')),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      Switch(
                        value: c.activa,
                        onChanged: (v) =>
                            _hacer(() => Dependencias.de(context).personal.activarCola(c.id, v), v ? 'Cola activada' : 'Cola pausada'),
                      ),
                      IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Eliminar', onPressed: () => _eliminar(c)),
                    ]),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

// ── Ventanillas ──

class VistaVentanillas extends StatefulWidget {
  const VistaVentanillas({super.key});

  @override
  State<VistaVentanillas> createState() => _VistaVentanillasState();
}

class _VistaVentanillasState extends State<VistaVentanillas> {
  Future<(List<VentanillaNegocio>, List<ColaNegocio>)>? _datos;

  Future<(List<VentanillaNegocio>, List<ColaNegocio>)> _cargar() async {
    final personal = Dependencias.de(context).personal;
    return (await personal.ventanillas(), await personal.colas());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _datos ??= _cargar();
  }

  void _recargar() => setState(() => _datos = _cargar());

  Future<void> _hacer(Future<void> Function() accion, String exito) async {
    try {
      await accion();
      if (mounted) _avisar(context, exito);
    } on ErrorTurno catch (e) {
      if (mounted) _avisar(context, e.mensaje);
    }
    if (mounted) _recargar();
  }

  Future<void> _renombrar(VentanillaNegocio v) async {
    final datos = await _pedirTextos(context, 'Nombre de la ventanilla', [('Nombre (ej. Consultorio 1)', v.nombre, 40)]);
    if (datos == null || !mounted) return;
    await _hacer(() => Dependencias.de(context).personal.editarVentanilla(v.id, nombre: datos[0]), 'Ventanilla renombrada');
  }

  Future<void> _crear(List<ColaNegocio> libres) async {
    var cola = libres.first.id;
    final nombre = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (contexto) => StatefulBuilder(
        builder: (contexto, cambiar) => AlertDialog(
          title: const Text('Nueva ventanilla'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: nombre, maxLength: 40, decoration: const InputDecoration(labelText: 'Nombre', border: OutlineInputBorder())),
            DropdownButtonFormField<int>(
              initialValue: cola,
              decoration: const InputDecoration(labelText: 'Cola que atiende', border: OutlineInputBorder()),
              items: [for (final c in libres) DropdownMenuItem(value: c.id, child: Text(c.nombre))],
              onChanged: (v) => cambiar(() => cola = v ?? cola),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.of(contexto).pop(false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.of(contexto).pop(true), child: const Text('Crear')),
          ],
        ),
      ),
    );
    if (ok == true && mounted) {
      await _hacer(() => Dependencias.de(context).personal.crearVentanilla(nombre: nombre.text, colaId: cola), 'Ventanilla creada');
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<(List<VentanillaNegocio>, List<ColaNegocio>)>(
      future: _datos,
      builder: (context, estado) {
        if (estado.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (estado.hasError) {
          final e = estado.error;
          return Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: e is ErrorTurno ? e.mensaje : 'Revisa tu conexión.',
              accion: 'Reintentar', alPulsar: _recargar);
        }
        final (ventanillas, colas) = estado.data!;
        final ocupadas = {for (final v in ventanillas) if (v.activa && v.colaId != null) v.colaId};
        final libres = colas.where((c) => c.activa && !ocupadas.contains(c.id)).toList();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Cada ventanilla atiende una sola cola. Los operadores ven solo las ventanillas que les asignes en la web.'),
            const SizedBox(height: 8),
            for (final v in ventanillas)
              Card(
                child: ListTile(
                  title: Text(v.nombre),
                  subtitle: Text(v.cola ?? 'Sin cola'),
                  onTap: () => _renombrar(v),
                  trailing: Switch(
                    value: v.activa,
                    onChanged: (a) => _hacer(() => Dependencias.de(context).personal.editarVentanilla(v.id, activa: a),
                        a ? 'Ventanilla activada' : 'Ventanilla pausada'),
                  ),
                ),
              ),
            const SizedBox(height: 8),
            if (libres.isNotEmpty)
              OutlinedButton.icon(onPressed: () => _crear(libres), icon: const Icon(Icons.add), label: const Text('Nueva ventanilla'))
            else
              const Text('Todas tus colas ya tienen ventanilla. Para otra ventanilla, crea otra cola.'),
          ],
        );
      },
    );
  }
}

// ── WhatsApp ──

/// Número del negocio para los avisos: se guarda y se vincula con un código desde el mismo celular (sin escanear QR).
class VistaWhatsApp extends StatefulWidget {
  const VistaWhatsApp({super.key});

  @override
  State<VistaWhatsApp> createState() => _VistaWhatsAppState();
}

class _VistaWhatsAppState extends State<VistaWhatsApp> {
  WhatsAppNegocio? _estado;
  String? _error;
  var _ocupado = false;
  final _numero = TextEditingController();
  final _prueba = TextEditingController();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_estado == null && _error == null) _hacer(Dependencias.de(context).personal.whatsapp);
  }

  @override
  void dispose() {
    _numero.dispose();
    _prueba.dispose();
    super.dispose();
  }

  Future<void> _hacer(Future<WhatsAppNegocio> Function() accion, {String? exito}) async {
    setState(() => _ocupado = true);
    try {
      final e = await accion();
      if (!mounted) return;
      setState(() {
        _estado = e;
        _error = null;
        if (_numero.text.isEmpty && e.numero != null) {
          _numero.text = e.numero!.length > 9 ? e.numero!.substring(e.numero!.length - 9) : e.numero!;
        }
      });
      if (exito != null) _avisar(context, exito);
    } on ErrorTurno catch (e) {
      if (!mounted) return;
      if (_estado == null) {
        setState(() => _error = e.mensaje);
      } else {
        _avisar(context, e.mensaje);
      }
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _estado;
    final tema = Theme.of(context);
    if (e == null) {
      return _error == null
          ? const Center(child: CircularProgressIndicator())
          : Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: _error!);
    }
    final personal = Dependencias.de(context).personal;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: e.conectado ? ColoresTurnoYa.exitoFondo : ColoresTurnoYa.alertaFondo,
          child: ListTile(
            leading: Icon(e.conectado ? Icons.check_circle : Icons.link_off, color: e.conectado ? ColoresTurnoYa.exito : ColoresTurnoYa.alerta),
            title: Text(e.conectado ? 'WhatsApp conectado' : 'WhatsApp sin vincular'),
            subtitle: Text(e.conectado
                ? 'Los avisos salen desde ${e.telefono ?? e.numero ?? 'tu número'}${e.nombre != null ? ' (${e.nombre})' : ''}.'
                : 'Vincula el WhatsApp del negocio para avisar a los clientes que no tienen la app.'),
          ),
        ),
        if (!e.configurado)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('El servidor aún no tiene el gateway de WhatsApp (OpenWA). Puedes guardar tu número; la vinculación estará '
                'disponible cuando se configure.'),
          ),
        if (e.error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(e.error!, style: TextStyle(color: tema.colorScheme.error))),
        const SizedBox(height: 16),
        Text('1. Número del negocio', style: tema.textTheme.titleMedium),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _numero,
              keyboardType: TextInputType.phone,
              maxLength: 15,
              decoration: const InputDecoration(labelText: 'Celular con WhatsApp', hintText: '951234567', border: OutlineInputBorder()),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 52)),
            onPressed: _ocupado ? null : () => _hacer(() => personal.guardarNumero(_numero.text), exito: 'Número guardado'),
            child: const Text('Guardar'),
          ),
        ]),
        if (e.numero != null && !e.conectado) ...[
          const SizedBox(height: 16),
          Text('2. Vincular sin escanear', style: tema.textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Toca «Pedir código». Luego en WhatsApp: Dispositivos vinculados → Vincular un dispositivo → «Vincular con número '
              'de teléfono» y escribe el código.'),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _ocupado ? null : () => _hacer(personal.pedirCodigo),
            icon: const Icon(Icons.key),
            label: Text(_ocupado ? 'Pidiendo…' : 'Pedir código'),
          ),
          if (e.codigo != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(children: [
                  const Text('Tu código'),
                  SelectableText(e.codigo!, style: tema.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 4)),
                  TextButton(onPressed: () => _hacer(personal.whatsapp), child: const Text('Ya lo escribí: actualizar estado')),
                ]),
              ),
            ),
        ],
        if (e.conectado) ...[
          const SizedBox(height: 16),
          Text('Probar', style: tema.textTheme.titleMedium),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _prueba,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Enviar prueba a', hintText: '951234567', border: OutlineInputBorder()),
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 50)),
              onPressed: _ocupado ? null : () => _hacer(() => personal.probarWhatsapp(_prueba.text), exito: 'Mensaje de prueba enviado'),
              child: const Text('Enviar'),
            ),
          ]),
          TextButton(
            onPressed: _ocupado ? null : () => _hacer(personal.desvincularWhatsapp, exito: 'WhatsApp desvinculado'),
            child: Text('Desvincular', style: TextStyle(color: tema.colorScheme.error)),
          ),
        ],
      ],
    );
  }
}
