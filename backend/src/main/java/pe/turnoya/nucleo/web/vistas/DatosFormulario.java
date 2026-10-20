package pe.turnoya.nucleo.web.vistas;

/** Datos que el cliente ya escribió, para volver a llenar el formulario si algo falló. */
public record DatosFormulario(String nombre, String telefono, boolean consentimiento, String categoria) {
}
