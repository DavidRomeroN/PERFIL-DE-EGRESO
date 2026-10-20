package pe.turnoya.tiemporeal.bus;

/** Publica un evento para todas las instancias de la aplicación. */
public interface BusTiempoReal {

    void publicar(EventoTiempoReal evento);
}
