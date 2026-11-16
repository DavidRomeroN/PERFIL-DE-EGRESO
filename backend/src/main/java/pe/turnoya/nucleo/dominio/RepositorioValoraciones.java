package pe.turnoya.nucleo.dominio;

/** Puerto de salida: valoraciones de la atención. Lo implementa {@code infraestructura.ValoracionesJdbc}. */
public interface RepositorioValoraciones {

    boolean existe(int turnoId);

    Valoracion guardar(int turnoId, int estrellas, String comentario);
}
