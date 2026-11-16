package pe.turnoya.nucleo.infraestructura;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.dominio.RepositorioValoraciones;
import pe.turnoya.nucleo.dominio.Valoracion;

/** Acceso a la tabla {@code valoracion}. */
@Repository
class ValoracionesJdbc implements RepositorioValoraciones {

    private final JdbcClient jdbc;

    ValoracionesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean existe(int turnoId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM valoracion WHERE turno_id = :id)").param("id", turnoId).query(Boolean.class).single();
    }

    @Override
    public Valoracion guardar(int turnoId, int estrellas, String comentario) {
        return jdbc.sql("INSERT INTO valoracion (turno_id, estrellas, comentario) VALUES (:id, :estrellas, :comentario) RETURNING id, created_at")
                .param("id", turnoId).param("estrellas", estrellas).param("comentario", comentario)
                .query((rs, i) -> new Valoracion(rs.getInt("id"), turnoId, estrellas, comentario, Sql.instante(rs, "created_at")))
                .single();
    }
}
