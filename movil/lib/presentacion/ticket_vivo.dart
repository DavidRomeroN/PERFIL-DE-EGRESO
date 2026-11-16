import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Bloquea capturas y grabaciones de pantalla mientras está visible (Android: FLAG_SECURE). En otras plataformas o
/// en pruebas no hace nada.
class PantallaProtegida extends StatefulWidget {
  const PantallaProtegida({super.key, required this.activa, required this.child});

  final bool activa;
  final Widget child;

  @override
  State<PantallaProtegida> createState() => _PantallaProtegidaState();
}

class _PantallaProtegidaState extends State<PantallaProtegida> {
  static const _canal = MethodChannel('turnoya/pantalla');

  Future<void> _proteger(bool si) async {
    try {
      await _canal.invokeMethod<void>('proteger', si);
    } on MissingPluginException {
      // iOS, escritorio o pruebas: sin bloqueo
    } on PlatformException {
      // No crítico: el ticket vivo sigue delatando una captura
    }
  }

  @override
  void initState() {
    super.initState();
    if (widget.activa) _proteger(true);
  }

  @override
  void didUpdateWidget(PantallaProtegida anterior) {
    super.didUpdateWidget(anterior);
    if (anterior.activa != widget.activa) _proteger(widget.activa);
  }

  @override
  void dispose() {
    if (widget.activa) _proteger(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Sello del ticket: franjas que se desplazan sin parar y la hora con segundos. En la ventanilla, una captura o una
/// foto del ticket se nota porque está quieta y con otra hora.
class SelloVivo extends StatefulWidget {
  const SelloVivo({super.key, required this.color});

  final Color color;

  @override
  State<SelloVivo> createState() => _SelloVivoState();
}

class _SelloVivoState extends State<SelloVivo> with SingleTickerProviderStateMixin {
  late final AnimationController _movimiento = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void dispose() {
    _movimiento.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Ticket en vivo',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: SizedBox(
          height: 44,
          child: AnimatedBuilder(
            animation: _movimiento,
            builder: (context, _) {
              final ahora = DateTime.now();
              String dos(int n) => n.toString().padLeft(2, '0');
              return CustomPaint(
                painter: _Franjas(color: widget.color, avance: _movimiento.value),
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Transform.rotate(angle: _movimiento.value * 6.2832, child: Icon(Icons.autorenew, size: 18, color: widget.color)),
                        const SizedBox(width: 6),
                        Text('${dos(ahora.hour)}:${dos(ahora.minute)}:${dos(ahora.second)}',
                            style: TextStyle(fontWeight: FontWeight.bold, fontFeatures: const [FontFeature.tabularFigures()], color: widget.color)),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Franjas extends CustomPainter {
  _Franjas({required this.color, required this.avance});

  final Color color;
  final double avance;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = color.withValues(alpha: 0.25));
    final franja = Paint()..color = color;
    const ancho = 14.0;
    const paso = ancho * 2;
    final desplazamiento = avance * paso;
    for (var x = -size.height - paso + desplazamiento; x < size.width + size.height; x += paso) {
      final path = Path()
        ..moveTo(x, size.height)
        ..lineTo(x + ancho, size.height)
        ..lineTo(x + ancho + size.height, 0)
        ..lineTo(x + size.height, 0)
        ..close();
      canvas.drawPath(path, franja);
    }
  }

  @override
  bool shouldRepaint(_Franjas anterior) => anterior.avance != avance || anterior.color != color;
}
