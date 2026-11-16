import 'package:flutter/material.dart';

import '../dominio/citas.dart';
import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_reservar_cita.dart';
import 'tema.dart';

/// Directorio para reservar: todos los locales registrados que reciben citas (no solo los que el cliente ya visitó),
/// con buscador por nombre, rubro o ciudad.
class PantallaLocalesCitas extends StatefulWidget {
  const PantallaLocalesCitas({super.key});

  @override
  State<PantallaLocalesCitas> createState() => _PantallaLocalesCitasState();
}

class _PantallaLocalesCitasState extends State<PantallaLocalesCitas> {
  Future<List<LocalConCitas>>? _locales;
  var _filtro = '';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _locales ??= Dependencias.de(context).citas.locales();
  }

  Future<void> _recargar() async {
    final futuro = Dependencias.de(context).citas.locales();
    setState(() => _locales = futuro);
    try {
      await futuro;
    } on ErrorTurno {
      // Se muestra en la lista
    }
  }

  static String _sinTildes(String s) => s
      .toLowerCase()
      .replaceAll(RegExp('[áà]'), 'a')
      .replaceAll(RegExp('[éè]'), 'e')
      .replaceAll(RegExp('[íì]'), 'i')
      .replaceAll(RegExp('[óò]'), 'o')
      .replaceAll(RegExp('[úùü]'), 'u');

  bool _coincide(LocalConCitas l) {
    if (_filtro.isEmpty) return true;
    final texto = _sinTildes([l.nombre, l.rubro ?? '', l.ciudad ?? ''].join(' '));
    return texto.contains(_sinTildes(_filtro));
  }

  static Color _color(String? hex) {
    final limpio = (hex ?? '').replaceFirst('#', '');
    final valor = int.tryParse(limpio, radix: 16);
    return limpio.length == 6 && valor != null ? Color(0xFF000000 | valor) : ColoresTurnoYa.primario;
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Reservar cita')),
      body: RefreshIndicator(
        onRefresh: _recargar,
        child: FutureBuilder<List<LocalConCitas>>(
          future: _locales,
          builder: (context, estado) {
            if (estado.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            final todos = estado.data;
            if (estado.hasError || todos == null) {
              final e = estado.error;
              return ListView(children: [
                Invitacion(
                  icono: Icons.cloud_off,
                  titulo: 'No se pudo cargar',
                  texto: e is ErrorTurno ? e.mensaje : 'Revisa tu conexión.',
                  accion: 'Reintentar',
                  alPulsar: _recargar,
                ),
              ]);
            }
            if (todos.isEmpty) {
              return ListView(children: const [
                Invitacion(icono: Icons.event_busy, titulo: 'Sin locales con cita', texto: 'Por ahora ningún local recibe reservas.'),
              ]);
            }
            final visibles = todos.where(_coincide).toList();
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                TextField(
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Buscar por nombre, rubro o ciudad',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (v) => setState(() => _filtro = v.trim()),
                ),
                const SizedBox(height: 12),
                Text(todos.length == 1 ? '1 local recibe citas' : '${todos.length} locales reciben citas', style: tema.textTheme.bodySmall),
                const SizedBox(height: 4),
                if (visibles.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Ningún local coincide con tu búsqueda.')),
                for (final l in visibles)
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: _color(l.color),
                        foregroundColor: Colors.white,
                        child: Text(l.nombre.isEmpty ? '?' : l.nombre.characters.first.toUpperCase()),
                      ),
                      title: Text(l.nombre),
                      subtitle: Text([
                        if (l.rubro != null && l.rubro!.isNotEmpty) l.rubro!,
                        if (l.ciudad != null && l.ciudad!.isNotEmpty) l.ciudad!,
                        l.servicios == 1 ? '1 servicio' : '${l.servicios} servicios',
                      ].join(' · ')),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(builder: (_) => PantallaReservarCita(slug: l.slug, nombreLocal: l.nombre)),
                      ),
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
