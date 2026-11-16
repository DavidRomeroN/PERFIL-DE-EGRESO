import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Cámara para leer el QR de la TV. Devuelve el texto del QR a la pantalla anterior.
class PantallaEscaner extends StatefulWidget {
  const PantallaEscaner({super.key});

  @override
  State<PantallaEscaner> createState() => _PantallaEscanerState();
}

class _PantallaEscanerState extends State<PantallaEscaner> {
  final _camara = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  var _leido = false;

  void _detectar(BarcodeCapture captura) {
    final valor = captura.barcodes.isEmpty ? null : captura.barcodes.first.rawValue;
    if (_leido || valor == null) return;
    _leido = true;
    Navigator.of(context).pop(valor);
  }

  @override
  void dispose() {
    _camara.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escanea el QR de la app')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _camara, onDetect: _detectar),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(16)),
            ),
          ),
          const Positioned(
            left: 24,
            right: 24,
            bottom: 32,
            child: Text('Apunta al QR azul «App» de la pantalla del local',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 16, shadows: [Shadow(blurRadius: 6)])),
          ),
        ],
      ),
    );
  }
}
