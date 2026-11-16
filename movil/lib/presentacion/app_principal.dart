import 'package:flutter/material.dart';

import 'dependencias.dart';
import 'pantalla_acceso.dart';
import 'pantalla_inicio.dart';
import 'pantalla_mis_locales.dart';
import 'pantalla_mis_turnos.dart';
import 'pantalla_perfil.dart';

/// Pantalla principal con cuatro pestañas: Inicio, Locales, Mis turnos y Cuenta. Cada vez que se entra a una pestaña
/// se recarga (los datos pudieron cambiar en otra).
class PantallaPrincipal extends StatefulWidget {
  const PantallaPrincipal({super.key});

  @override
  State<PantallaPrincipal> createState() => _PantallaPrincipalState();
}

class _PantallaPrincipalState extends State<PantallaPrincipal> {
  static const _inicio = 0;
  static const _turnos = 2;
  static const _cuenta = 3;

  var _pestana = _inicio;
  var _visita = 0;

  void _ir(int pestana) => setState(() {
        _pestana = pestana;
        _visita++;
      });

  @override
  Widget build(BuildContext context) {
    final sesion = Dependencias.de(context).sesion;
    final Widget contenido = switch (_pestana) {
      _inicio => PantallaInicio(alCrearCuenta: () => _ir(_cuenta)),
      1 => const PantallaMisLocales(),
      _turnos => PantallaMisTurnos(alCrearCuenta: () => _ir(_cuenta)),
      _ => ListenableBuilder(
          listenable: sesion,
          builder: (context, _) => sesion.conCuenta
              ? PantallaPerfil(key: const ValueKey('perfil'), alVerTurnos: () => _ir(_turnos))
              : const PantallaAcceso(key: ValueKey('acceso'), embebida: true),
        ),
    };
    return Scaffold(
      body: KeyedSubtree(key: ValueKey('$_pestana-$_visita'), child: contenido),
      bottomNavigationBar: ListenableBuilder(
        listenable: sesion,
        builder: (context, _) => NavigationBar(
          selectedIndex: _pestana,
          onDestinationSelected: _ir,
          destinations: [
            const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Inicio'),
            const NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Locales'),
            const NavigationDestination(icon: Icon(Icons.history_outlined), selectedIcon: Icon(Icons.history), label: 'Mis turnos'),
            NavigationDestination(
              icon: Icon(sesion.conCuenta ? Icons.account_circle_outlined : Icons.person_add_alt),
              selectedIcon: const Icon(Icons.account_circle),
              label: sesion.conCuenta ? 'Cuenta' : 'Ingresar',
            ),
          ],
        ),
      ),
    );
  }
}
