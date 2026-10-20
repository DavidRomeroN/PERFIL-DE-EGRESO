package pe.turnoya.compartido.web;

import com.google.zxing.WriterException;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.google.zxing.qrcode.encoder.ByteMatrix;
import com.google.zxing.qrcode.encoder.Encoder;
import com.google.zxing.qrcode.encoder.QRCode;
import org.springframework.stereotype.Component;

/**
 * Códigos QR en SVG generados en el servidor. El controlador lo deja en el modelo ({@code qrSvg}) y la plantilla lo
 * inserta con {@code th:utext="${qrSvg}"} (Thymeleaf 3.1 no permite llamar beans dentro de {@code th:utext}).
 * Reemplaza a qrcode.react de legacy/ sin JavaScript en el navegador.
 */
@Component("qr")
public class GeneradorQr {

    private static final int MARGEN = 2;

    public String svg(String texto, int tamanoPx) {
        try {
            QRCode qr = Encoder.encode(texto, ErrorCorrectionLevel.M);
            ByteMatrix matriz = qr.getMatrix();
            int lado = matriz.getWidth() + 2 * MARGEN;
            StringBuilder ruta = new StringBuilder();
            for (int y = 0; y < matriz.getHeight(); y++) {
                for (int x = 0; x < matriz.getWidth(); x++) {
                    if (matriz.get(x, y) == 1) {
                        ruta.append('M').append(x + MARGEN).append(' ').append(y + MARGEN).append("h1v1h-1z");
                    }
                }
            }
            return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + lado + " " + lado + "\" width=\"" + tamanoPx
                    + "\" height=\"" + tamanoPx + "\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"Código QR\">"
                    + "<rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>"
                    + "<path fill=\"#0f172a\" d=\"" + ruta + "\"/></svg>";
        } catch (WriterException e) {
            throw new IllegalArgumentException("No se pudo generar el QR", e);
        }
    }
}
