import 'package:flutter/material.dart';

import '../dominio/citas.dart';
import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_acceso.dart';
import 'tema.dart';

/// Reservar una cita en el local: servicio → día → hora. Va a nombre de la cuenta (sin cuenta, invita a ingresar).
class PantallaReservarCita extends StatefulWidget {
  const PantallaReservarCita({super.key, required this.slug, required this.nombreLocal});

  final String slug;
  final String nombreLocal;

  @override
  State<PantallaReservarCita> createState() => _PantallaReservarCitaState();
}

class _PantallaReservarCitaState extends State<PantallaReservarCita> {
  Future<OfertaCitas>? _oferta;
  ServicioCita? _servicio;
  Future<List<DiaCita>>? _dias;
  String? _fecha;
  Future<List<HorarioCita>>? _horarios;
  var _reservando = false;

  static const _dias3 = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _oferta ??= Dependencias.de(context).citas.oferta(widget.slug);
  }

  void _elegirServicio(ServicioCita s) => setState(() {
        _servicio = s;
        _fecha = null;
        _horarios = null;
        _dias = Dependencias.de(context).citas.dias(widget.slug, s.id);
      });

  void _elegirDia(String fecha) => setState(() {
        _fecha = fecha;
        _horarios = Dependencias.de(context).citas.horarios(widget.slug, _servicio!.id, fecha);
      });

  Future<void> _reservar(HorarioCita h) async {
    final dependencias = Dependencias.de(context);
    final mensajero = ScaffoldMessenger.of(context);
    final navegador = Navigator.of(context);
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: const Text('¿Reservar esta cita?'),
        content: Text('${_servicio!.nombre}\n${_etiquetaDia(_fecha!)} a las ${h.hora}\n\n'
            'Al llegar, escanea el QR «App» de la pantalla del local para hacer check-in. Si no te presentas, no podrás '
            'reservar en este local por 1 día; si vuelves a faltar, 3 días, y así cada vez más.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(contexto).pop(false), child: const Text('Volver')),
          FilledButton(onPressed: () => Navigator.of(contexto).pop(true), child: const Text('Reservar')),
        ],
      ),
    );
    if (confirmado != true) return;
    setState(() => _reservando = true);
    try {
      await dependencias.citas.reservar(slug: widget.slug, servicioId: _servicio!.id, horarioId: h.id);
      mensajero.showSnackBar(const SnackBar(content: Text('Cita reservada. La verás en la pestaña «Citas».')));
      navegador.pop();
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') dependencias.sesion.establecer(null);
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
      if (mounted) {
        setState(() {
          _reservando = false;
          if (_fecha != null) _horarios = dependencias.citas.horarios(widget.slug, _servicio!.id, _fecha!);
        });
      }
    }
  }

  String _etiquetaDia(String fecha) {
    final d = DateTime.tryParse(fecha);
    if (d == null) return fecha;
    return '${_dias3[d.weekday - 1]} ${d.day}/${d.month}';
  }

  @override
  Widget build(BuildContext context) {
    final sesion = Dependencias.de(context).sesion;
    final tema = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text('Cita en ${widget.nombreLocal}')),
      body: ListenableBuilder(
        listenable: sesion,
        builder: (context, _) {
          if (!sesion.conCuenta) {
            return Center(
              child: SingleChildScrollView(
                child: Invitacion(
                  icono: Icons.event_available,
                  titulo: 'Ingresa para reservar',
                  texto: 'Las citas quedan a nombre de tu cuenta: así puedes verlas, cancelarlas y hacer check-in al llegar.',
                  accion: 'Crear cuenta o ingresar',
                  alPulsar: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PantallaAcceso())),
                ),
              ),
            );
          }
          return FutureBuilder<OfertaCitas>(
            future: _oferta,
            builder: (context, estado) {
              if (estado.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              final oferta = estado.data;
              if (estado.hasError || oferta == null) {
                final e = estado.error;
                return Invitacion(icono: Icons.cloud_off, titulo: 'No se pudo cargar', texto: e is ErrorTurno ? e.mensaje : 'Revisa tu conexión.');
              }
              if (!oferta.disponible || oferta.servicios.isEmpty) {
                return const Invitacion(
                    icono: Icons.event_busy, titulo: 'Sin citas', texto: 'Este local no atiende con cita. Puedes tomar turno al llegar.');
              }
              return AbsorbPointer(
                absorbing: _reservando,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text('1. Servicio', style: tema.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final s in oferta.servicios)
                        ChoiceChip(label: Text(s.nombre), selected: _servicio?.id == s.id, onSelected: (_) => _elegirServicio(s)),
                    ]),
                    if (_dias != null) ...[
                      const SizedBox(height: 20),
                      Text('2. Día', style: tema.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      FutureBuilder<List<DiaCita>>(
                        future: _dias,
                        builder: (context, e) {
                          if (e.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                          final dias = (e.data ?? const <DiaCita>[]).where((d) => d.abierto && d.libres > 0).toList();
                          if (e.hasError) return Text(e.error is ErrorTurno ? (e.error as ErrorTurno).mensaje : 'No se pudo cargar');
                          if (dias.isEmpty) return const Text('No quedan cupos en los próximos días.');
                          return Wrap(spacing: 8, runSpacing: 8, children: [
                            for (final d in dias)
                              ChoiceChip(
                                label: Text('${_etiquetaDia(d.fecha)} · ${d.libres} cupos'),
                                selected: _fecha == d.fecha,
                                onSelected: (_) => _elegirDia(d.fecha),
                              ),
                          ]);
                        },
                      ),
                    ],
                    if (_horarios != null) ...[
                      const SizedBox(height: 20),
                      Text('3. Hora', style: tema.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      FutureBuilder<List<HorarioCita>>(
                        future: _horarios,
                        builder: (context, e) {
                          if (e.connectionState != ConnectionState.done) return const LinearProgressIndicator();
                          final horas = (e.data ?? const <HorarioCita>[]).where((h) => h.disponible).toList();
                          if (horas.isEmpty) return const Text('No quedan horarios ese día.');
                          return Wrap(spacing: 8, runSpacing: 8, children: [
                            for (final h in horas) OutlinedButton(onPressed: () => _reservar(h), child: Text(h.hora)),
                          ]);
                        },
                      ),
                    ],
                    if (_reservando) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
