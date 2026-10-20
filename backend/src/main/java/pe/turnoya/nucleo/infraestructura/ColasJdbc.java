package pe.turnoya.nucleo.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.nucleo.dominio.Cola;

/** Acceso a la tabla {@code cola}. */
@Repository
public class ColasJdbc {

    private static final String COLUMNAS = "id, local_id, prefijo, nombre, descripcion, activa, tiempo_atencion_base, orden";

    private final JdbcClient jdbc;

    public ColasJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Cola> porId(int id) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM cola WHERE id = :id").param("id", id).query(ColasJdbc::cola).optional();
    }

    public Optional<Cola> porIdEnLocal(int id, int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM cola WHERE id = :id AND local_id = :local")
                .param("id", id).param("local", localId).query(ColasJdbc::cola).optional();
    }

    public List<Cola> delLocal(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM cola WHERE local_id = :local ORDER BY orden, id")
                .param("local", localId).query(ColasJdbc::cola).list();
    }

    public List<Cola> activasDelLocal(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM cola WHERE local_id = :local AND activa ORDER BY orden, id")
                .param("local", localId).query(ColasJdbc::cola).list();
    }

    public int contar(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM cola WHERE local_id = :local").param("local", localId).query(Integer.class).single();
    }

    public int contarTurnos(int colaId) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE cola_id = :cola").param("cola", colaId).query(Integer.class).single();
    }

    public int crear(int localId, String prefijo, String nombre, String descripcion, int tiempoAtencionBase, boolean activa, int orden) {
        return jdbc.sql("""
                        INSERT INTO cola (local_id, prefijo, nombre, descripcion, tiempo_atencion_base, activa, orden)
                        VALUES (:local, :prefijo, :nombre, :descripcion, :tiempo, :activa, :orden) RETURNING id""")
                .param("local", localId).param("prefijo", prefijo).param("nombre", nombre).param("descripcion", descripcion)
                .param("tiempo", tiempoAtencionBase).param("activa", activa).param("orden", orden)
                .query(Integer.class).single();
    }

    public void actualizar(Cola c) {
        jdbc.sql("""
                        UPDATE cola SET prefijo = :prefijo, nombre = :nombre, descripcion = :descripcion,
                               tiempo_atencion_base = :tiempo, activa = :activa, orden = :orden
                         WHERE id = :id""")
                .param("prefijo", c.prefijo()).param("nombre", c.nombre()).param("descripcion", c.descripcion())
                .param("tiempo", c.tiempoAtencionBase()).param("activa", c.activa()).param("orden", c.orden()).param("id", c.id())
                .update();
    }

    public void eliminar(int id) {
        jdbc.sql("DELETE FROM cola WHERE id = :id").param("id", id).update();
    }

    private static Cola cola(ResultSet rs, int fila) throws SQLException {
        return new Cola(rs.getInt("id"), rs.getInt("local_id"), rs.getString("prefijo"), rs.getString("nombre"),
                rs.getString("descripcion"), rs.getBoolean("activa"), rs.getInt("tiempo_atencion_base"), rs.getInt("orden"));
    }
}
