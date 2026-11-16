import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'tema.dart';

/// Perfil del cliente (pestaña «Cuenta» con sesión): sus datos, el estado de su cuenta —faltas de los últimos días,
/// si está bloqueado y hasta cuándo— y los turnos activos. [alVerTurnos] lleva a la pestaña «Mis turnos».
class PantallaPerfil extends StatefulWidget {
  const PantallaPerfil({super.key, required this.alVerTurnos});

  final VoidCallback alVerTurnos;

  @override
  State<PantallaPerfil> createState() => _PantallaPerfilState();
}

class _PantallaPerfilState extends State<PantallaPerfil> {
  Future<Perfil>? _perfil;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _perfil ??= _cargar();
  }

  Future<Perfil> _cargar() async {
    final dependencias = Dependencias.de(context);
    try {
      return await dependencias.verPerfil();
    } on ErrorTurno catch (e) {
      if (e.codigo == 'APP_SESION_INVALIDA') dependencias.sesion.establecer(null);
      rethrow;
    }
  }

  Future<void> _recargar() async {
    final futuro = _cargar();
    setState(() => _perfil = futuro);
    try {
      await futuro;
    } on ErrorTurno {
      // Se muestra en la pantalla
    }
  }

  Future<void> _salir() async {
    final si = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('¿Cerrar sesión?'),
        content: const Text('Tu historial queda guardado en tu cuenta. Podrás volver a ingresar cuando quieras.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cerrar sesión')),
        ],
      ),
    );
    if (si == true && mounted) await Dependencias.de(context).sesion.cerrar();
  }

  @override
  Widget build(BuildContext context) {
    final cuenta = Dependencias.de(context).sesion.cuenta;
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _recargar,
        child: FutureBuilder<Perfil>(
          future: _perfil,
          builder: (context, estado) {
            final perfil = estado.data;
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              children: [
                _Cabecera(cuenta: perfil?.cuenta ?? cuenta ?? const Cuenta(), miembroDesde: perfil?.miembroDesde),
                const SizedBox(height: 16),
                if (estado.connectionState != ConnectionState.done)
                  const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
                else if (estado.hasError)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.wifi_off),
                      title: Text(estado.error is ErrorTurno ? (estado.error as ErrorTurno).mensaje : 'No se pudo cargar tu perfil.'),
                      trailing: TextButton(onPressed: _recargar, child: const Text('Reintentar')),
                    ),
                  )
                else ...[
                  _EstadoCuenta(perfil: perfil!),
                  const SizedBox(height: 4),
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.confirmation_number_outlined),
                      title: Text(perfil.maxActivos == 1 ? 'Turno activo' : 'Turnos activos'),
                      subtitle: Text(perfil.maxActivos == 1
                          ? (perfil.activos >= 1
                              ? 'Ya tienes tu turno. Para tomar otro, espera a que te atiendan o cancélalo.'
                              : 'Puedes tomar un turno a la vez en cualquier local')
                          : 'Puedes tener hasta ${perfil.maxActivos} a la vez entre todos los locales'),
                      trailing: Text('${perfil.activos} / ${perfil.maxActivos}',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                    ),
                  ),
                  if (perfil.faltas.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text('Faltas de los últimos ${perfil.diasFaltas} días', style: Theme.of(context).textTheme.titleMedium),
                    for (final f in perfil.faltas)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.event_busy, color: ColoresTurnoYa.peligro),
                          title: Text('${f.codigo} · ${f.cola}'),
                          subtitle: Text('${f.local} · ${fechaCorta(f.fecha)}'),
                        ),
                      ),
                  ],
                ],
                const SizedBox(height: 16),
                FilledButton.tonalIcon(onPressed: widget.alVerTurnos, icon: const Icon(Icons.history), label: const Text('Ver mis turnos')),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: _salir,
                  icon: const Icon(Icons.logout),
                  label: const Text('Cerrar sesión'),
                  style: TextButton.styleFrom(foregroundColor: ColoresTurnoYa.peligro),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Cabecera extends StatelessWidget {
  const _Cabecera({required this.cuenta, this.miembroDesde});

  final Cuenta cuenta;
  final DateTime? miembroDesde;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [ColoresTurnoYa.primario, ColoresTurnoYa.primarioOscuro]),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: Colors.white,
            child: Text(cuenta.iniciales, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: ColoresTurnoYa.primario)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(cuenta.nombre ?? 'Mi cuenta', style: tema.textTheme.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700)),
                Text(cuenta.identificador, style: const TextStyle(color: Colors.white70)),
                if (miembroDesde != null)
                  Text('Miembro desde ${miembroDesde!.day}/${miembroDesde!.month}/${miembroDesde!.year}',
                      style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Semáforo de la cuenta: sin faltas (verde), con faltas (ámbar) o bloqueada (rojo).
class _EstadoCuenta extends StatelessWidget {
  const _EstadoCuenta({required this.perfil});

  final Perfil perfil;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final p = perfil;
    final (color, icono, titulo, detalle) = p.bloqueado
        ? (
            ColoresTurnoYa.peligro,
            Icons.block,
            'Bloqueado para tomar turnos en la app',
            'Faltaste a ${p.faltas.length} turnos en los últimos ${p.diasFaltas} días. Podrás volver a tomar turnos desde el '
                '${fechaCorta(p.bloqueadoHasta!)}. Mientras, puedes acercarte al local.'
          )
        : p.faltas.isEmpty
            ? (ColoresTurnoYa.exito, Icons.verified, 'Sin penalizaciones', '¡Bien! No tienes faltas en los últimos ${p.diasFaltas} días.')
            : (
                ColoresTurnoYa.alerta,
                Icons.warning_amber_rounded,
                '${p.faltas.length} de ${p.maxFaltas} faltas',
                'Si faltas ${p.faltasRestantes == 1 ? 'a 1 turno más' : 'a ${p.faltasRestantes} turnos más'} en ${p.diasFaltas} días, la app '
                    'no te dejará tomar turnos por unos días. Si no vas a ir, cancela tu turno.'
              );
    return Card(
      color: color.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: color.withValues(alpha: 0.4))),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icono, color: color, size: 28),
              const SizedBox(width: 10),
              Expanded(child: Text(titulo, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700, color: color))),
            ]),
            const SizedBox(height: 10),
            Row(
              children: [
                for (var i = 0; i < p.maxFaltas; i++)
                  Expanded(
                    child: Container(
                      height: 8,
                      margin: EdgeInsets.only(right: i == p.maxFaltas - 1 ? 0 : 6),
                      decoration: BoxDecoration(
                        color: i < p.faltas.length ? color : color.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text(detalle),
          ],
        ),
      ),
    );
  }
}
