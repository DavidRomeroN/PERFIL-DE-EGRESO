import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_local.dart';

/// Locales visitados y favoritos: se abren sin escanear para ver la espera en vivo y las mejores horas.
class PantallaMisLocales extends StatefulWidget {
  const PantallaMisLocales({super.key});

  @override
  State<PantallaMisLocales> createState() => _PantallaMisLocalesState();
}

class _PantallaMisLocalesState extends State<PantallaMisLocales> {
  List<LocalGuardado>? _locales;
  String? _abriendo;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_locales == null) _cargar();
  }

  Future<void> _cargar() async {
    final lista = await Dependencias.de(context).misLocales();
    if (mounted) setState(() => _locales = lista);
  }

  Future<void> _abrir(LocalGuardado guardado) async {
    setState(() => _abriendo = guardado.slug);
    try {
      final local = await Dependencias.de(context).abrirLocal.desdeQr(guardado.slug);
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute<Turno>(builder: (_) => PantallaLocal(local: local)));
    } on ErrorTurno catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    } finally {
      if (mounted) setState(() => _abriendo = null);
      await _cargar();
    }
  }

  Future<void> _favorito(LocalGuardado l) async {
    await Dependencias.de(context).misLocales.alternarFavorito(l.slug);
    await _cargar();
  }

  Future<void> _olvidar(LocalGuardado l) async {
    final misLocales = Dependencias.de(context).misLocales;
    await misLocales.olvidar(l.slug);
    await _cargar();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('${l.nombre} quitado de tus locales'),
      action: SnackBarAction(
        label: 'Deshacer',
        onPressed: () async {
          final lista = [...await misLocales(), l];
          await misLocales.restaurar(lista);
          await _cargar();
        },
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final locales = _locales;
    return Scaffold(
      appBar: AppBar(title: const Text('Mis locales')),
      body: locales == null
          ? const Center(child: CircularProgressIndicator())
          : locales.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(
                    child: Text('Aquí aparecerán los locales que visites. Escanea el QR de un local y podrás volver a ver su espera desde aquí.',
                        textAlign: TextAlign.center),
                  ),
                )
              : ListView(
                  children: [
                    const Padding(
                      padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: Text('Toca un local para ver su espera en vivo. Desliza para quitarlo.'),
                    ),
                    for (final l in locales)
                      Dismissible(
                        key: ValueKey(l.slug),
                        direction: DismissDirection.endToStart,
                        background: Container(
                          color: Colors.red.shade400,
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.only(right: 20),
                          child: const Icon(Icons.delete_outline, color: Colors.white),
                        ),
                        onDismissed: (_) => _olvidar(l),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: colorDesdeHex(l.colorPrimario),
                            foregroundColor: Colors.white,
                            child: Text(l.nombre.isEmpty ? '?' : l.nombre.characters.first.toUpperCase()),
                          ),
                          title: Text(l.nombre),
                          subtitle: Text('Última visita: ${_fecha(l.ultimaVisita)}'),
                          trailing: _abriendo == l.slug
                              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                              : IconButton(
                                  tooltip: l.favorito ? 'Quitar de favoritos' : 'Marcar como favorito',
                                  icon: Icon(l.favorito ? Icons.star : Icons.star_border, color: l.favorito ? Colors.amber.shade700 : null),
                                  onPressed: () => _favorito(l),
                                ),
                          onTap: _abriendo == null ? () => _abrir(l) : null,
                        ),
                      ),
                  ],
                ),
    );
  }

  static String _fecha(DateTime f) {
    final hoy = DateTime.now();
    String dos(int n) => n.toString().padLeft(2, '0');
    if (f.year == hoy.year && f.month == hoy.month && f.day == hoy.day) return 'hoy ${dos(f.hour)}:${dos(f.minute)}';
    return '${dos(f.day)}/${dos(f.month)}/${f.year}';
  }
}
