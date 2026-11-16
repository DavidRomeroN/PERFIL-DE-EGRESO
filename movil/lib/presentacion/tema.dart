import 'package:flutter/material.dart';

/// Colores de la marca TurnoYa.
abstract final class ColoresTurnoYa {
  static const primario = Color(0xFF2563EB);
  static const primarioOscuro = Color(0xFF1E40AF);
  static const fondo = Color(0xFFF4F6FB);
  static const exito = Color(0xFF16A34A);
  static const alerta = Color(0xFFD97706);
  static const peligro = Color(0xFFDC2626);
}

/// Tema de la app: Material 3 con tarjetas planas y redondeadas, botones altos y campos rellenos.
ThemeData temaTurnoYa() {
  final esquema = ColorScheme.fromSeed(seedColor: ColoresTurnoYa.primario, primary: ColoresTurnoYa.primario, surface: Colors.white);
  final base = ThemeData(colorScheme: esquema, useMaterial3: true);
  final redondeo = BorderRadius.circular(14);
  return base.copyWith(
    scaffoldBackgroundColor: ColoresTurnoYa.fondo,
    appBarTheme: const AppBarTheme(
      backgroundColor: ColoresTurnoYa.fondo,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF0F172A)),
    ),
    textTheme: base.textTheme.apply(bodyColor: const Color(0xFF0F172A), displayColor: const Color(0xFF0F172A)),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: Color(0xFFE2E8F0))),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: redondeo),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: redondeo),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCBD5E1))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCBD5E1))),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: esquema.primaryContainer,
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}

/// Aviso grande con ícono para estados vacíos o invitaciones (sin cuenta, sin turnos…).
class Invitacion extends StatelessWidget {
  const Invitacion({super.key, required this.icono, required this.titulo, required this.texto, this.accion, this.alPulsar});

  final IconData icono;
  final String titulo;
  final String texto;
  final String? accion;
  final VoidCallback? alPulsar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 40,
            backgroundColor: tema.colorScheme.primaryContainer,
            child: Icon(icono, size: 40, color: tema.colorScheme.primary),
          ),
          const SizedBox(height: 16),
          Text(titulo, textAlign: TextAlign.center, style: tema.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(texto, textAlign: TextAlign.center, style: tema.textTheme.bodyMedium?.copyWith(color: const Color(0xFF475569))),
          if (accion != null) ...[
            const SizedBox(height: 20),
            FilledButton(onPressed: alPulsar, child: Text(accion!)),
          ],
        ],
      ),
    );
  }
}

/// `15/11 14:05`.
String fechaCorta(DateTime f) {
  String dos(int n) => n.toString().padLeft(2, '0');
  return '${dos(f.day)}/${dos(f.month)} ${dos(f.hour)}:${dos(f.minute)}';
}
