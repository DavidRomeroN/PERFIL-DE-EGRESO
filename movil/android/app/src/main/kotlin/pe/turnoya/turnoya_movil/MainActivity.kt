package pe.turnoya.turnoya_movil

import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Antifraude: mientras se ve el ticket, el sistema no deja capturarlo ni grabarlo (y sale en negro en "recientes")
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "turnoya/pantalla").setMethodCallHandler { llamada, resultado ->
            when (llamada.method) {
                "proteger" -> {
                    if (llamada.arguments == true) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                    resultado.success(null)
                }
                else -> resultado.notImplemented()
            }
        }
    }
}
