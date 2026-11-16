import 'package:flutter/material.dart';

/// Colores de la marca TurnoYa: el verde azulado de la web (teal), fondos casi blancos con un toque verdoso y texto
/// pizarra. Los estados usan tonos suaves de fondo con texto oscuro del mismo color para que se lean bien.
abstract final class ColoresTurnoYa {
  static const primario = Color(0xFF0F766E);
  static const primarioOscuro = Color(0xFF134E4A);
  static const primarioClaro = Color(0xFFCCFBF1);
  static const acento = Color(0xFF14B8A6);
  static const fondo = Color(0xFFF5F9F8);
  static const superficie = Colors.white;
  static const borde = Color(0xFFDDE7E5);
  static const texto = Color(0xFF0F1F24);
  static const textoSuave = Color(0xFF52636A);
  static const neutro = Color(0xFF64748B);

  static const exito = Color(0xFF15803D);
  static const exitoFondo = Color(0xFFDCFCE7);
  static const alerta = Color(0xFFB45309);
  static const alertaFondo = Color(0xFFFEF3C7);
  static const peligro = Color(0xFFDC2626);
  static const peligroFondo = Color(0xFFFEE2E2);
  static const info = Color(0xFF0E7490);
  static const infoFondo = Color(0xFFE0F2F1);
}

/// Tema de la app: Material 3 con la paleta de la marca, tarjetas planas con borde suave, botones altos y campos
/// rellenos.
ThemeData temaTurnoYa() {
  final esquema = ColorScheme.fromSeed(
    seedColor: ColoresTurnoYa.primario,
    primary: ColoresTurnoYa.primario,
    onPrimary: Colors.white,
    primaryContainer: ColoresTurnoYa.primarioClaro,
    onPrimaryContainer: ColoresTurnoYa.primarioOscuro,
    secondary: ColoresTurnoYa.acento,
    surface: ColoresTurnoYa.superficie,
    onSurface: ColoresTurnoYa.texto,
    onSurfaceVariant: ColoresTurnoYa.textoSuave,
    outline: ColoresTurnoYa.borde,
    outlineVariant: ColoresTurnoYa.borde,
    error: ColoresTurnoYa.peligro,
    errorContainer: ColoresTurnoYa.peligroFondo,
  );
  final base = ThemeData(colorScheme: esquema, useMaterial3: true);
  final redondeo = BorderRadius.circular(14);
  final borde = OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: ColoresTurnoYa.borde));
  return base.copyWith(
    scaffoldBackgroundColor: ColoresTurnoYa.fondo,
    appBarTheme: const AppBarTheme(
      backgroundColor: ColoresTurnoYa.fondo,
      foregroundColor: ColoresTurnoYa.texto,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: -0.3, color: ColoresTurnoYa.texto),
    ),
    textTheme: base.textTheme.apply(bodyColor: ColoresTurnoYa.texto, displayColor: ColoresTurnoYa.texto),
    iconTheme: const IconThemeData(color: ColoresTurnoYa.textoSuave),
    listTileTheme: const ListTileThemeData(iconColor: ColoresTurnoYa.primario),
    dividerTheme: const DividerThemeData(color: ColoresTurnoYa.borde, space: 1),
    cardTheme: CardThemeData(
      color: ColoresTurnoYa.superficie,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: ColoresTurnoYa.borde)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        backgroundColor: ColoresTurnoYa.primario,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFE2E8E7),
        disabledForegroundColor: const Color(0xFF94A3A8),
        shape: RoundedRectangleBorder(borderRadius: redondeo),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        foregroundColor: ColoresTurnoYa.primario,
        side: const BorderSide(color: ColoresTurnoYa.borde, width: 1.2),
        shape: RoundedRectangleBorder(borderRadius: redondeo),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: ColoresTurnoYa.primario, textStyle: const TextStyle(fontWeight: FontWeight.w600)),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: ColoresTurnoYa.primario,
      foregroundColor: Colors.white,
      elevation: 2,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: ColoresTurnoYa.superficie,
      border: borde,
      enabledBorder: borde,
      focusedBorder: borde.copyWith(borderSide: const BorderSide(color: ColoresTurnoYa.primario, width: 1.6)),
      labelStyle: const TextStyle(color: ColoresTurnoYa.textoSuave),
      floatingLabelStyle: const TextStyle(color: ColoresTurnoYa.primario),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((estados) => estados.contains(WidgetState.selected) ? ColoresTurnoYa.primario : null),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: ColoresTurnoYa.fondo,
      selectedColor: ColoresTurnoYa.primarioClaro,
      side: const BorderSide(color: ColoresTurnoYa.borde),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: ColoresTurnoYa.primario, linearTrackColor: ColoresTurnoYa.primarioClaro),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: ColoresTurnoYa.superficie,
      surfaceTintColor: Colors.transparent,
      indicatorColor: ColoresTurnoYa.primarioClaro,
      iconTheme: WidgetStateProperty.resolveWith((estados) => IconThemeData(
            color: estados.contains(WidgetState.selected) ? ColoresTurnoYa.primarioOscuro : ColoresTurnoYa.textoSuave,
          )),
      labelTextStyle: WidgetStateProperty.resolveWith((estados) => TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: estados.contains(WidgetState.selected) ? ColoresTurnoYa.primarioOscuro : ColoresTurnoYa.textoSuave,
          )),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: ColoresTurnoYa.superficie,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      showDragHandle: true,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: ColoresTurnoYa.superficie,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: ColoresTurnoYa.superficie,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: ColoresTurnoYa.primarioOscuro,
      contentTextStyle: const TextStyle(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}

/// Tono de un aviso dentro de una pantalla.
enum TonoAviso { info, alerta, exito, peligro }

/// Aviso en línea (sin conexión, local cerrado, sanción…) con los colores suaves de la marca según su tono.
class AvisoTarjeta extends StatelessWidget {
  const AvisoTarjeta({super.key, required this.tono, required this.icono, required this.titulo, this.texto});

  final TonoAviso tono;
  final IconData icono;
  final String titulo;
  final String? texto;

  @override
  Widget build(BuildContext context) {
    final (fondo, color) = switch (tono) {
      TonoAviso.info => (ColoresTurnoYa.infoFondo, ColoresTurnoYa.info),
      TonoAviso.alerta => (ColoresTurnoYa.alertaFondo, ColoresTurnoYa.alerta),
      TonoAviso.exito => (ColoresTurnoYa.exitoFondo, ColoresTurnoYa.exito),
      TonoAviso.peligro => (ColoresTurnoYa.peligroFondo, ColoresTurnoYa.peligro),
    };
    return Card(
      color: fondo,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: color.withValues(alpha: 0.18))),
      child: ListTile(
        leading: Icon(icono, color: color),
        title: Text(titulo, style: TextStyle(fontWeight: FontWeight.w600, color: Color.lerp(color, Colors.black, 0.35))),
        subtitle: texto == null ? null : Text(texto!, style: TextStyle(color: Color.lerp(color, Colors.black, 0.5))),
      ),
    );
  }
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
          Text(texto, textAlign: TextAlign.center, style: tema.textTheme.bodyMedium?.copyWith(color: ColoresTurnoYa.textoSuave)),
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
