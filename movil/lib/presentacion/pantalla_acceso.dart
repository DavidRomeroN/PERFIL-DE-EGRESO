import 'package:flutter/material.dart';

import '../aplicacion/casos_de_uso.dart';
import '../dominio/modelos.dart';
import 'dependencias.dart';
import 'pantalla_ingresar.dart';

/// Crear cuenta o ingresar con correo y contraseña. Va dentro de la pestaña «Cuenta» ([embebida]) o como pantalla
/// propia (desde un local o al pedir las mejores horas): entonces devuelve la [Cuenta] al terminar.
/// Desde un local ([slug]) también ofrece ingresar con el celular por WhatsApp.
class PantallaAcceso extends StatefulWidget {
  const PantallaAcceso({super.key, this.embebida = false, this.slug, this.nombreLocal, this.motivo});

  final bool embebida;
  final String? slug;
  final String? nombreLocal;

  /// Por qué se pide la cuenta (p. ej. «Las mejores horas son para usuarios con cuenta»).
  final String? motivo;

  @override
  State<PantallaAcceso> createState() => _PantallaAccesoState();
}

class _PantallaAccesoState extends State<PantallaAcceso> {
  final _nombre = TextEditingController();
  final _correo = TextEditingController();
  final _clave = TextEditingController();
  var _registro = true;
  var _verClave = false;
  var _acepta = false;
  var _ocupado = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _clave.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _nombre.dispose();
    _correo.dispose();
    _clave.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    FocusScope.of(context).unfocus();
    final dependencias = Dependencias.de(context);
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      final sesion = _registro
          ? await dependencias.registrarCuenta(correo: _correo.text, clave: _clave.text, nombre: _nombre.text, acepta: _acepta)
          : await dependencias.ingresarConCorreo(correo: _correo.text, clave: _clave.text);
      dependencias.sesion.establecer(sesion.cuenta);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_registro ? '¡Cuenta creada! Bienvenido${sesion.cuenta.nombre == null ? '' : ', ${sesion.cuenta.nombre}'}.' : 'Ingresaste a tu cuenta')));
      if (!widget.embebida) Navigator.of(context).pop(sesion.cuenta);
    } on ErrorTurno catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _conCelular() async {
    final dependencias = Dependencias.de(context);
    final cuenta = await Navigator.of(context).push<Cuenta>(
        MaterialPageRoute(builder: (_) => PantallaIngresar(slug: widget.slug!, nombreLocal: widget.nombreLocal ?? 'el local')));
    if (cuenta == null || !mounted) return;
    dependencias.sesion.establecer(cuenta);
    if (!widget.embebida) Navigator.of(context).pop(cuenta);
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final problemaClave = _clave.text.isEmpty ? null : RegistrarCuenta.problemaDeClave(_clave.text);
    final contenido = ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        if (widget.embebida) ...[
          const SizedBox(height: 8),
          Text('Tu cuenta TurnoYa', style: tema.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
        ],
        const SizedBox(height: 8),
        if (widget.motivo != null)
          Card(
            color: tema.colorScheme.primaryContainer,
            child: ListTile(leading: const Icon(Icons.lock_open), title: Text(widget.motivo!)),
          ),
        const _Beneficios(),
        const SizedBox(height: 16),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: true, label: Text('Crear cuenta'), icon: Icon(Icons.person_add_alt)),
            ButtonSegment(value: false, label: Text('Ingresar'), icon: Icon(Icons.login)),
          ],
          selected: {_registro},
          onSelectionChanged: _ocupado ? null : (s) => setState(() {
                _registro = s.first;
                _error = null;
              }),
        ),
        const SizedBox(height: 16),
        AutofillGroup(
          child: Column(
            children: [
              if (_registro) ...[
                TextField(
                  controller: _nombre,
                  enabled: !_ocupado,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  decoration: const InputDecoration(labelText: 'Nombre y apellido', prefixIcon: Icon(Icons.badge_outlined)),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: _correo,
                enabled: !_ocupado,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.email],
                autocorrect: false,
                decoration: const InputDecoration(labelText: 'Correo', hintText: 'nombre@gmail.com', prefixIcon: Icon(Icons.alternate_email)),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _clave,
                enabled: !_ocupado,
                obscureText: !_verClave,
                autocorrect: false,
                enableSuggestions: false,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _enviar(),
                autofillHints: [_registro ? AutofillHints.newPassword : AutofillHints.password],
                decoration: InputDecoration(
                  labelText: 'Contraseña',
                  prefixIcon: const Icon(Icons.lock_outline),
                  helperText: _registro ? (problemaClave ?? (_clave.text.isEmpty ? 'Mínimo 8 caracteres, con letras y números' : 'Contraseña segura ✓')) : null,
                  helperStyle: TextStyle(color: _registro && _clave.text.isNotEmpty ? (problemaClave == null ? Colors.green.shade700 : Colors.orange.shade800) : null),
                  suffixIcon: IconButton(
                    tooltip: _verClave ? 'Ocultar contraseña' : 'Mostrar contraseña',
                    icon: Icon(_verClave ? Icons.visibility_off : Icons.visibility),
                    onPressed: () => setState(() => _verClave = !_verClave),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_registro)
          CheckboxListTile(
            value: _acepta,
            onChanged: _ocupado ? null : (v) => setState(() => _acepta = v ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text('Acepto que TurnoYa guarde mis datos y mi historial de turnos (Ley 29733).'),
          ),
        if (_error != null)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: tema.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              Icon(Icons.error_outline, color: tema.colorScheme.error),
              const SizedBox(width: 8),
              Expanded(child: Text(_error!, style: TextStyle(color: tema.colorScheme.onErrorContainer))),
            ]),
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _ocupado ? null : _enviar,
          child: _ocupado
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
              : Text(_registro ? 'Crear mi cuenta' : 'Ingresar'),
        ),
        if (widget.slug != null) ...[
          const SizedBox(height: 12),
          const Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text('o')), Expanded(child: Divider())]),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _ocupado ? null : _conCelular,
            icon: const Icon(Icons.phone_android),
            label: const Text('Ingresar con mi celular (WhatsApp)'),
          ),
        ],
      ],
    );
    if (widget.embebida) return SafeArea(child: contenido);
    return Scaffold(appBar: AppBar(title: Text(_registro ? 'Crear cuenta' : 'Ingresar')), body: contenido);
  }
}

/// Qué gana el cliente con una cuenta.
class _Beneficios extends StatelessWidget {
  const _Beneficios();

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    Widget fila(IconData icono, String texto) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [Icon(icono, color: color, size: 22), const SizedBox(width: 10), Expanded(child: Text(texto))]),
        );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            fila(Icons.history, 'Historial de tus últimos turnos en todos los locales'),
            fila(Icons.insights, 'Mejores horas para ir a cada servicio'),
            fila(Icons.verified_user_outlined, 'Estado de tu cuenta: faltas y penalizaciones'),
            fila(Icons.badge_outlined, 'Tus turnos a tu nombre, desde cualquier teléfono'),
          ],
        ),
      ),
    );
  }
}
