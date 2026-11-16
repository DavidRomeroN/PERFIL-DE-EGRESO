import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_escaner.dart';
import 'pantalla_local.dart';
import 'pantalla_mi_turno.dart';
import 'tema.dart';

/// Pestaña de inicio: saludo, botón para escanear el QR de la TV, el turno activo, los últimos locales y, sin cuenta,
/// la invitación a crearla ([alCrearCuenta] lleva a la pestaña «Cuenta»).
class PantallaInicio extends StatefulWidget {
  const PantallaInicio({super.key, required this.alCrearCuenta});

  final VoidCallback alCrearCuenta;

  @override
  State<PantallaInicio> createState() => _PantallaInicioState();
}

class _PantallaInicioState extends State<PantallaInicio> {
  var _cargando = true;
  var _iniciado = false;
  String? _error;
  Turno? _turno;
  List<LocalGuardado> _recientes = const [];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciado) {
      _iniciado = true;
      _actualizar();
    }
  }

  /// Turno activo y últimos locales: al abrir la pestaña y al volver de otra pantalla.
  Future<void> _actualizar() async {
    final dependencias = Dependencias.de(context);
    final turno = await dependencias.recuperarTurno();
    final recientes = await dependencias.misLocales();
    if (!mounted) return;
    setState(() {
      _cargando = false;
      _turno = turno;
      _recientes = recientes.take(6).toList();
    });
  }

  Future<void> _ir(Widget pantalla) async {
    await Navigator.of(context).push(MaterialPageRoute<Object>(builder: (_) => pantalla));
    if (mounted) await _actualizar();
  }

  Future<void> _escanear() async {
    final contenido = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const PantallaEscaner()));
    if (contenido != null) await _abrir(contenido);
  }

  Future<void> _abrir(String contenido) async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final local = await Dependencias.de(context).abrirLocal.desdeQr(contenido);
      if (!mounted) return;
      final turno = await Navigator.of(context).push<Turno>(MaterialPageRoute(builder: (_) => PantallaLocal(local: local)));
      if (turno != null && mounted) await _ir(PantallaMiTurno(turno: turno));
    } on ErrorTurno catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) await _actualizar();
    }
  }

  @override
  Widget build(BuildContext context) {
    final sesion = Dependencias.de(context).sesion;
    final turno = _turno;
    return RefreshIndicator(
      onRefresh: _actualizar,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          ListenableBuilder(
            listenable: sesion,
            builder: (context, _) => _Cabecera(
              nombre: sesion.cuenta?.nombre,
              cargando: _cargando,
              alEscanear: _escanear,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_error != null)
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: ListTile(leading: const Icon(Icons.error_outline), title: Text(_error!)),
                  ),
                if (turno != null) _TarjetaTurno(turno: turno, onTap: () => _ir(PantallaMiTurno(turno: turno))),
                ListenableBuilder(
                  listenable: sesion,
                  builder: (context, _) => sesion.conCuenta ? const SizedBox.shrink() : _InvitarCuenta(alPulsar: widget.alCrearCuenta),
                ),
                if (_recientes.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text('Tus locales', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 96,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _recientes.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 10),
                      itemBuilder: (context, i) => _LocalReciente(local: _recientes[i], alPulsar: () => _abrir(_recientes[i].slug)),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                const _ComoFunciona(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Cabecera extends StatelessWidget {
  const _Cabecera({required this.nombre, required this.cargando, required this.alEscanear});

  final String? nombre;
  final bool cargando;
  final VoidCallback alEscanear;

  @override
  Widget build(BuildContext context) {
    final arriba = MediaQuery.paddingOf(context).top;
    return Container(
      padding: EdgeInsets.fromLTRB(20, arriba + 20, 20, 24),
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [ColoresTurnoYa.primario, ColoresTurnoYa.primarioOscuro]),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.confirmation_number, color: Colors.white),
            const SizedBox(width: 6),
            const Expanded(child: Text('TurnoYa', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18))),
            if (cargando) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
          ]),
          const SizedBox(height: 18),
          Text(nombre == null ? '¡Hola!' : 'Hola, ${nombre!.split(' ').first}',
              style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('Toma tu turno y espera donde quieras.', style: TextStyle(color: Colors.white70, fontSize: 15)),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: cargando ? null : alEscanear,
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: ColoresTurnoYa.primario,
                minimumSize: const Size.fromHeight(58),
                textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              icon: const Icon(Icons.qr_code_scanner, size: 26),
              label: const Text('Escanear QR del local'),
            ),
          ),
        ],
      ),
    );
  }
}

/// El turno activo, para volver a él con un toque.
class _TarjetaTurno extends StatelessWidget {
  const _TarjetaTurno({required this.turno, required this.onTap});

  final Turno turno;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final llamado = turno.estado == EstadoTurno.llamado;
    final color = llamado ? ColoresTurnoYa.exito : colorDesdeHex(turno.colorPrimario);
    return Card(
      color: color,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(llamado ? '¡Es tu turno!' : 'Tu turno activo', style: const TextStyle(color: Colors.white70)),
                    Text(turno.codigo, style: const TextStyle(color: Colors.white, fontSize: 38, fontWeight: FontWeight.w900, height: 1.1)),
                    Text('${turno.cola} · ${turno.localNombre}', style: const TextStyle(color: Colors.white)),
                    const SizedBox(height: 6),
                    Text(
                      llamado
                          ? (turno.ventanilla == null ? 'Acércate a la ventanilla' : 'Acércate a ${turno.ventanilla}')
                          : turno.personasDelante == 0
                              ? '¡Eres el siguiente!'
                              : '${turno.personasDelante} personas delante · ~${turno.minutosEstimados} min',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
              const CircleAvatar(backgroundColor: Colors.white24, child: Icon(Icons.arrow_forward, color: Colors.white)),
            ],
          ),
        ),
      ),
    );
  }
}

class _InvitarCuenta extends StatelessWidget {
  const _InvitarCuenta({required this.alPulsar});

  final VoidCallback alPulsar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Card(
      color: tema.colorScheme.primaryContainer.withValues(alpha: 0.5),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.workspace_premium, color: tema.colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(child: Text('Crea tu cuenta gratis', style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 6),
            const Text('Guarda tu historial, mira las mejores horas para ir y revisa el estado de tu cuenta.'),
            const SizedBox(height: 12),
            FilledButton(onPressed: alPulsar, child: const Text('Crear cuenta con mi correo')),
          ],
        ),
      ),
    );
  }
}

class _LocalReciente extends StatelessWidget {
  const _LocalReciente({required this.local, required this.alPulsar});

  final LocalGuardado local;
  final VoidCallback alPulsar;

  @override
  Widget build(BuildContext context) {
    final color = colorDesdeHex(local.colorPrimario);
    return SizedBox(
      width: 120,
      child: Card(
        margin: EdgeInsets.zero,
        child: InkWell(
          onTap: alPulsar,
          borderRadius: BorderRadius.circular(18),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(children: [
                  CircleAvatar(
                    radius: 14,
                    backgroundColor: color,
                    child: Text(local.nombre.isEmpty ? '?' : local.nombre.characters.first.toUpperCase(),
                        style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
                  ),
                  const Spacer(),
                  if (local.favorito) Icon(Icons.star, size: 18, color: Colors.amber.shade700),
                ]),
                Text(local.nombre, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ComoFunciona extends StatelessWidget {
  const _ComoFunciona();

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    Widget paso(IconData icono, String numero, String texto) => Expanded(
          child: Column(children: [
            CircleAvatar(radius: 24, backgroundColor: tema.colorScheme.primaryContainer, child: Icon(icono, color: tema.colorScheme.primary)),
            const SizedBox(height: 6),
            Text('$numero. $texto', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5)),
          ]),
        );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('¿Cómo funciona?', style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              paso(Icons.qr_code_scanner, '1', 'Escanea el QR de la pantalla'),
              paso(Icons.touch_app, '2', 'Elige el servicio'),
              paso(Icons.notifications_active, '3', 'Te avisamos cuando estés cerca'),
              paso(Icons.verified_user, '4', 'Muestra tu ticket vivo'),
            ]),
          ],
        ),
      ),
    );
  }
}
