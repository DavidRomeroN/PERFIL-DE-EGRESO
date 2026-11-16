import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'dependencias.dart';

/// Ingresar con el celular: se pide el código por WhatsApp (lo envía el local [slug]) y se verifica.
/// Devuelve la [Cuenta] abierta, o nada si el cliente vuelve atrás.
class PantallaIngresar extends StatefulWidget {
  const PantallaIngresar({super.key, required this.slug, required this.nombreLocal, this.color});

  final String slug;
  final String nombreLocal;
  final Color? color;

  @override
  State<PantallaIngresar> createState() => _PantallaIngresarState();
}

class _PantallaIngresarState extends State<PantallaIngresar> {
  final _telefono = TextEditingController();
  final _codigo = TextEditingController();
  final _nombre = TextEditingController();
  var _codigoEnviado = false;
  var _acepta = false;
  var _ocupado = false;
  String? _error;

  Future<void> _ejecutar(Future<void> Function() accion) async {
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      await accion();
    } on ErrorTurno catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _pedirCodigo() => _ejecutar(() async {
        await Dependencias.de(context).pedirCodigo(slug: widget.slug, telefono: _telefono.text);
        if (mounted) setState(() => _codigoEnviado = true);
      });

  Future<void> _verificar() => _ejecutar(() async {
        if (!_acepta) throw const ErrorTurno('CONSENTIMIENTO_REQUERIDO', 'Acepta el uso de tu celular para continuar.');
        final sesion = await Dependencias.de(context).iniciarSesion(telefono: _telefono.text, codigo: _codigo.text, nombre: _nombre.text);
        if (!mounted) return;
        Dependencias.de(context).sesion.establecer(sesion.cuenta);
        Navigator.of(context).pop(sesion.cuenta);
      });

  @override
  void dispose() {
    _telefono.dispose();
    _codigo.dispose();
    _nombre.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Ingresar con tu celular'), backgroundColor: widget.color, foregroundColor: widget.color == null ? null : Colors.white),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Con tu cuenta tus turnos quedan a tu nombre y puedes ver tu historial en todos los locales.', style: tema.textTheme.bodyLarge),
          const SizedBox(height: 16),
          TextField(
            controller: _telefono,
            enabled: !_codigoEnviado && !_ocupado,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            decoration: const InputDecoration(labelText: 'Celular', hintText: '987 654 321', prefixIcon: Icon(Icons.phone_android), border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          if (!_codigoEnviado)
            FilledButton(
              onPressed: _ocupado ? null : _pedirCodigo,
              child: const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Enviarme el código por WhatsApp')),
            )
          else ...[
            Text('Te enviamos un código de 6 dígitos por WhatsApp desde ${widget.nombreLocal}. Vence en 10 minutos.'),
            const SizedBox(height: 12),
            TextField(
              controller: _codigo,
              enabled: !_ocupado,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: const InputDecoration(labelText: 'Código', prefixIcon: Icon(Icons.pin_outlined), border: OutlineInputBorder()),
            ),
            TextField(
              controller: _nombre,
              enabled: !_ocupado,
              maxLength: 60,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Tu nombre (opcional)', border: OutlineInputBorder()),
            ),
            CheckboxListTile(
              value: _acepta,
              onChanged: _ocupado ? null : (v) => setState(() => _acepta = v ?? false),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text('Acepto que TurnoYa guarde mi celular para avisarme de mis turnos.'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _ocupado ? null : _verificar,
              child: const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Ingresar')),
            ),
            TextButton(
              onPressed: _ocupado
                  ? null
                  : () => setState(() {
                        _codigoEnviado = false;
                        _codigo.clear();
                      }),
              child: const Text('Cambiar número o reenviar el código'),
            ),
          ],
          if (_ocupado) const Padding(padding: EdgeInsets.only(top: 16), child: Center(child: CircularProgressIndicator())),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: tema.colorScheme.error)),
            ),
        ],
      ),
    );
  }
}
