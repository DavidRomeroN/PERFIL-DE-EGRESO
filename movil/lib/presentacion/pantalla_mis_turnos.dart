import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_mi_turno.dart';
import 'tema.dart';

/// Pestaña «Mis turnos»: historial de la cuenta en todos los locales; los activos se pueden seguir. Sin cuenta invita a
/// crearla ([alCrearCuenta] lleva a la pestaña «Cuenta»).
class PantallaMisTurnos extends StatefulWidget {
  const PantallaMisTurnos({super.key, required this.alCrearCuenta});

  final VoidCallback alCrearCuenta;

  @override
  State<PantallaMisTurnos> createState() => _PantallaMisTurnosState();
}

class _PantallaMisTurnosState extends State<PantallaMisTurnos> {
  Future<List<TurnoPasado>>? _turnos;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_turnos == null && Dependencias.de(context).sesion.conCuenta) _turnos = _cargar();
  }

  Future<List<TurnoPasado>> _cargar() async {
    final dependencias = Dependencias.de(context);
    try {
      return await dependencias.verHistorial();
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') dependencias.sesion.establecer(null);
      rethrow;
    }
  }

  Future<void> _recargar() async {
    final futuro = _cargar();
    setState(() => _turnos = futuro);
    try {
      await futuro;
    } on ErrorTurno {
      // Se muestra en la lista
    }
  }

  Future<void> _seguir(TurnoPasado t) async {
    final dependencias = Dependencias.de(context);
    try {
      final turno = await dependencias.retomarTurno(t.token!);
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PantallaMiTurno(turno: turno)));
      if (mounted) await _recargar();
    } on ErrorTurno catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final sesion = Dependencias.de(context).sesion;
    return Scaffold(
      appBar: AppBar(title: const Text('Mis turnos')),
      body: ListenableBuilder(
        listenable: sesion,
        builder: (context, _) {
          if (!sesion.conCuenta) {
            return Center(
              child: SingleChildScrollView(
                child: Invitacion(
                  icono: Icons.history,
                  titulo: 'Guarda tu historial',
                  texto: 'Crea tu cuenta gratis con tu correo y aquí verás tus últimos turnos de todos los locales.',
                  accion: 'Crear cuenta o ingresar',
                  alPulsar: widget.alCrearCuenta,
                ),
              ),
            );
          }
          _turnos ??= _cargar();
          return RefreshIndicator(
            onRefresh: _recargar,
            child: FutureBuilder<List<TurnoPasado>>(
              future: _turnos,
              builder: (context, estado) {
                if (estado.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (estado.hasError) {
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
                final turnos = estado.data ?? const [];
                if (turnos.isEmpty) {
                  return ListView(children: const [
                    Invitacion(icono: Icons.confirmation_number_outlined, titulo: 'Aún no tienes turnos', texto: 'Escanea el QR de un local para tomar tu primer turno.'),
                  ]);
                }
                final activos = turnos.where((t) => t.activo).toList();
                final anteriores = turnos.where((t) => !t.activo).toList();
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  children: [
                    if (activos.isNotEmpty) ...[
                      const _Titulo('En curso'),
                      for (final t in activos) _TarjetaHistorial(turno: t, onTap: () => _seguir(t)),
                    ],
                    if (anteriores.isNotEmpty) ...[
                      const _Titulo('Anteriores'),
                      for (final t in anteriores) _TarjetaHistorial(turno: t),
                    ],
                  ],
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _Titulo extends StatelessWidget {
  const _Titulo(this.texto);

  final String texto;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
        child: Text(texto, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: ColoresTurnoYa.neutro, fontWeight: FontWeight.w700)),
      );
}

class _TarjetaHistorial extends StatelessWidget {
  const _TarjetaHistorial({required this.turno, this.onTap});

  final TurnoPasado turno;
  final VoidCallback? onTap;

  static Color _color(EstadoTurno e) => switch (e) {
        EstadoTurno.atendido => ColoresTurnoYa.exito,
        EstadoTurno.noSePresento => ColoresTurnoYa.peligro,
        EstadoTurno.cancelado => ColoresTurnoYa.neutro,
        EstadoTurno.llamado => ColoresTurnoYa.exito,
        _ => ColoresTurnoYa.primario,
      };

  @override
  Widget build(BuildContext context) {
    final t = turno;
    final color = _color(t.estado);
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 64,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: Text(t.codigo, textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w800, color: color)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.cola, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text('${t.local}${t.emitidoAt == null ? '' : ' · ${fechaCorta(t.emitidoAt!)}'}',
                        style: const TextStyle(color: ColoresTurnoYa.neutro, fontSize: 13)),
                  ],
                ),
              ),
              if (onTap != null)
                const Icon(Icons.chevron_right)
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
                  child: Text(t.estado.etiqueta, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
