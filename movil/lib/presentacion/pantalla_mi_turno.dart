import 'dart:async';

import 'package:flutter/material.dart';
import 'tema.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'ticket_vivo.dart';

/// Seguimiento en vivo del turno: código, cuántos faltan, espera estimada y ventanilla cuando lo llaman.
class PantallaMiTurno extends StatefulWidget {
  const PantallaMiTurno({super.key, required this.turno});

  final Turno turno;

  @override
  State<PantallaMiTurno> createState() => _PantallaMiTurnoState();
}

class _PantallaMiTurnoState extends State<PantallaMiTurno> {
  late Turno _turno = widget.turno;
  StreamSubscription<Turno>? _seguimiento;
  var _sinConexion = false;
  var _cancelando = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _seguimiento ??= Dependencias.de(context).seguirTurno(widget.turno).listen(
          (t) => setState(() {
            _turno = t;
            _sinConexion = false;
          }),
          onError: (Object _) => setState(() => _sinConexion = true),
        );
  }

  @override
  void dispose() {
    _seguimiento?.cancel();
    super.dispose();
  }

  Future<void> _cancelar() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('¿Cancelar tu turno?'),
        content: Text('Perderás tu lugar en la cola (${_turno.codigo}).'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Sí, cancelar')),
        ],
      ),
    );
    if (confirmar != true || !mounted) return;
    setState(() => _cancelando = true);
    try {
      final t = await Dependencias.de(context).cancelarTurno(_turno.token);
      setState(() => _turno = t);
    } on ErrorTurno catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
    } finally {
      if (mounted) setState(() => _cancelando = false);
    }
  }

  Future<void> _otroTurno() async {
    await Dependencias.de(context).olvidarTurno();
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final t = _turno;
    final color = colorDesdeHex(t.colorPrimario);
    final tema = Theme.of(context);
    final llamado = t.estado == EstadoTurno.llamado;
    // Mientras el turno está activo el ticket es "vivo" y no se puede capturar (antifraude: no se revende una foto)
    return PantallaProtegida(
      activa: !t.estado.finalizado,
      child: PopScope(
      canPop: t.estado.finalizado,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.localNombre),
          backgroundColor: color,
          foregroundColor: Colors.white,
          automaticallyImplyLeading: t.estado.finalizado,
        ),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (_sinConexion)
              const AvisoTarjeta(tono: TonoAviso.alerta, icono: Icons.wifi_off, titulo: 'Sin conexión. Reintentando…'),
            Card(
              color: llamado ? ColoresTurnoYa.exito : null,
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Text(llamado ? '¡Es tu turno!' : 'Tu turno', style: tema.textTheme.titleMedium?.copyWith(color: llamado ? Colors.white : null)),
                    Text(t.codigo,
                        style: tema.textTheme.displayLarge?.copyWith(fontWeight: FontWeight.bold, color: llamado ? Colors.white : color)),
                    Text(t.cola, style: tema.textTheme.titleMedium?.copyWith(color: llamado ? Colors.white : null)),
                    const SizedBox(height: 8),
                    Chip(
                      avatar: const Icon(Icons.phone_iphone, size: 18),
                      label: Text(t.canal == 'APP' ? 'Tomado con la app' : 'Canal ${t.canal}'),
                    ),
                    if (!t.estado.finalizado) ...[
                      const SizedBox(height: 12),
                      SelloVivo(color: llamado ? Colors.white : color),
                      const SizedBox(height: 6),
                      Text('Muestra esta pantalla en la ventanilla: el sello se mueve y marca la hora.',
                          textAlign: TextAlign.center,
                          style: tema.textTheme.bodySmall?.copyWith(color: llamado ? Colors.white : null)),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (llamado)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.campaign, size: 36),
                  title: Text(t.ventanilla == null ? 'Acércate a la ventanilla' : 'Acércate a ${t.ventanilla}',
                      style: tema.textTheme.titleLarge),
                ),
              ),
            if (t.estado.enEspera) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.personasDelante == 0 ? '¡Eres el siguiente!' : '${t.personasDelante} personas delante de ti',
                          style: tema.textTheme.headlineSmall),
                      const SizedBox(height: 4),
                      Text(t.minutosEstimados == 0 ? 'Te llamarán en breve' : 'Espera aproximada: ${t.minutosEstimados} min'),
                      const SizedBox(height: 16),
                      LinearProgressIndicator(value: t.progreso, minHeight: 10, color: color, borderRadius: BorderRadius.circular(8)),
                      const SizedBox(height: 12),
                      Text('Te avisaremos con una notificación cuando falten ${t.avisarFaltando} personas o menos.',
                          style: tema.textTheme.bodySmall),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _cancelando ? null : _cancelar,
                icon: const Icon(Icons.close),
                label: const Text('Cancelar turno'),
                style: OutlinedButton.styleFrom(foregroundColor: tema.colorScheme.error),
              ),
            ],
            if (t.estado.finalizado) ...[
              Card(child: ListTile(leading: const Icon(Icons.check_circle_outline), title: Text('Turno ${t.estado.etiqueta.toLowerCase()}'))),
              const SizedBox(height: 12),
              FilledButton(onPressed: _otroTurno, child: const Text('Tomar otro turno')),
            ],
          ],
        ),
      ),
    ),
    );
  }
}
