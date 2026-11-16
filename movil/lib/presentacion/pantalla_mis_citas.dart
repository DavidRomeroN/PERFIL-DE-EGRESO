import 'package:flutter/material.dart';

import '../dominio/citas.dart';
import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_escaner.dart';
import 'pantalla_locales_citas.dart';
import 'pantalla_mi_turno.dart';
import 'tema.dart';

/// Pestaña «Citas»: las citas de la cuenta (próximas primero), las sanciones vigentes por no presentarse y, al llegar
/// al local, el check-in escaneando el QR «App» de la TV. «Reservar cita» abre todos los locales que reciben reservas.
class PantallaMisCitas extends StatefulWidget {
  const PantallaMisCitas({super.key, required this.alCrearCuenta});

  final VoidCallback alCrearCuenta;

  @override
  State<PantallaMisCitas> createState() => _PantallaMisCitasState();
}

class _PantallaMisCitasState extends State<PantallaMisCitas> {
  Future<MisCitas>? _citas;

  Future<MisCitas> _cargar() async {
    final dependencias = Dependencias.de(context);
    try {
      return await dependencias.citas.mias();
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') dependencias.sesion.establecer(null);
      rethrow;
    }
  }

  Future<void> _recargar() async {
    final futuro = _cargar();
    setState(() => _citas = futuro);
    try {
      await futuro;
    } on ErrorTurno {
      // Se muestra en la lista
    }
  }

  void _avisar(String texto) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texto)));
  }

  Future<void> _llegue(Cita cita) async {
    final dependencias = Dependencias.de(context);
    final navegador = Navigator.of(context);
    final qr = await navegador.push<String>(MaterialPageRoute(builder: (_) => const PantallaEscaner()));
    if (qr == null) return;
    try {
      final llegada = await dependencias.citas.llegue(cita, qr);
      _avisar(llegada.tarde
          ? 'Llegaste tarde: entraste a la fila como turno general (${llegada.codigo}).'
          : 'Check-in hecho. Tu turno es ${llegada.codigo}.');
      final turno = await dependencias.retomarTurno(llegada.turnoToken);
      if (!mounted) return;
      await navegador.push(MaterialPageRoute<void>(builder: (_) => PantallaMiTurno(turno: turno)));
    } on ErrorTurno catch (e) {
      _avisar(e.mensaje);
    }
    if (mounted) await _recargar();
  }

  Future<void> _cancelar(Cita cita) async {
    final dependencias = Dependencias.de(context);
    final si = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: const Text('¿Cancelar la cita?'),
        content: const Text('El horario quedará libre para otra persona. Cancelar no cuenta como falta.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(contexto).pop(false), child: const Text('No')),
          FilledButton(onPressed: () => Navigator.of(contexto).pop(true), child: const Text('Sí, cancelar')),
        ],
      ),
    );
    if (si != true) return;
    try {
      await dependencias.citas.cancelar(cita.token);
      _avisar('Cita cancelada');
    } on ErrorTurno catch (e) {
      _avisar(e.mensaje);
    }
    if (mounted) await _recargar();
  }

  Future<void> _reservar() async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PantallaLocalesCitas()));
    if (mounted) await _recargar();
  }

  Future<void> _verTurno(Cita cita) async {
    final dependencias = Dependencias.de(context);
    final navegador = Navigator.of(context);
    try {
      final turno = await dependencias.retomarTurno(cita.turnoToken!);
      await navegador.push(MaterialPageRoute<void>(builder: (_) => PantallaMiTurno(turno: turno)));
    } on ErrorTurno catch (e) {
      _avisar(e.mensaje);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sesion = Dependencias.de(context).sesion;
    return Scaffold(
      appBar: AppBar(title: const Text('Mis citas')),
      floatingActionButton: ListenableBuilder(
        listenable: sesion,
        builder: (context, _) => sesion.conCuenta
            ? FloatingActionButton.extended(onPressed: _reservar, icon: const Icon(Icons.add), label: const Text('Reservar cita'))
            : const SizedBox.shrink(),
      ),
      body: ListenableBuilder(
        listenable: sesion,
        builder: (context, _) {
          if (!sesion.conCuenta) {
            return Center(
              child: SingleChildScrollView(
                child: Invitacion(
                  icono: Icons.event,
                  titulo: 'Reserva citas con hora',
                  texto: 'Con tu cuenta puedes reservar citas en los locales que las ofrecen y hacer check-in al llegar.',
                  accion: 'Crear cuenta o ingresar',
                  alPulsar: widget.alCrearCuenta,
                ),
              ),
            );
          }
          _citas ??= _cargar();
          return RefreshIndicator(
            onRefresh: _recargar,
            child: FutureBuilder<MisCitas>(
              future: _citas,
              builder: (context, estado) {
                if (estado.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
                final datos = estado.data;
                if (estado.hasError || datos == null) {
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
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final s in datos.sanciones) _TarjetaSancion(s),
                    if (datos.citas.isEmpty)
                      const Invitacion(
                        icono: Icons.event_available,
                        titulo: 'Aún no tienes citas',
                        texto: 'Toca «Reservar cita» y elige el local, el servicio y la hora.',
                      ),
                    for (final c in datos.citas)
                      _TarjetaCita(
                        c,
                        alLlegar: () => _llegue(c),
                        alCancelar: () => _cancelar(c),
                        alVerTurno: c.turnoToken == null ? null : () => _verTurno(c),
                      ),
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

class _TarjetaSancion extends StatelessWidget {
  const _TarjetaSancion(this.sancion);

  final Sancion sancion;

  @override
  Widget build(BuildContext context) => Card(
        color: ColoresTurnoYa.alertaFondo,
        child: ListTile(
          leading: const Icon(Icons.block),
          title: Text('Sin citas en ${sancion.local} hasta el ${sancion.hastaTexto}'),
          subtitle: Text('${sancion.motivo}. Si vuelves a faltar, la espera será más larga; al asistir a una cita se borra.'),
        ),
      );
}

class _TarjetaCita extends StatelessWidget {
  const _TarjetaCita(this.cita, {required this.alLlegar, required this.alCancelar, this.alVerTurno});

  final Cita cita;
  final VoidCallback alLlegar;
  final VoidCallback alCancelar;
  final VoidCallback? alVerTurno;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final color = switch (cita.estado) {
      EstadoCita.noShow => tema.colorScheme.error,
      EstadoCita.cancelada => ColoresTurnoYa.neutro,
      _ => tema.colorScheme.primary,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(cita.servicio, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
              Chip(label: Text(cita.estado.texto), labelStyle: TextStyle(color: color), side: BorderSide(color: color)),
            ]),
            Text(cita.local, style: tema.textTheme.bodyMedium),
            Text(cita.inicioTexto, style: tema.textTheme.bodyLarge),
            if (cita.activa) ...[
              const SizedBox(height: 6),
              Text('Código para el kiosco: ${cita.codigo}', style: tema.textTheme.bodySmall),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                FilledButton.icon(onPressed: alLlegar, icon: const Icon(Icons.qr_code_scanner), label: const Text('Ya llegué')),
                TextButton(onPressed: alCancelar, child: const Text('Cancelar cita')),
              ]),
            ],
            if (alVerTurno != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton(onPressed: alVerTurno, child: Text('Ver mi turno ${cita.turnoCodigo ?? ''}')),
              ),
          ],
        ),
      ),
    );
  }
}
