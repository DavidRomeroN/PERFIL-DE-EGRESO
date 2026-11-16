package pe.turnoya.nucleo.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.dominio.Ventanilla;
import pe.turnoya.nucleo.dominio.RepositorioVentanillas;

/** Acceso a la tabla {@code ventanilla}. */
@Repository
class VentanillasJdbc implements RepositorioVentanillas {

    private static final String COLUMNAS = "id, local_id, nombre, cola_id, activa";

    private final JdbcClient jdbc;

    VentanillasJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Ventanilla> porIdEnLocal(int id, int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM ventanilla WHERE id = :id AND local_id = :local")
                .param("id", id).param("local", localId).query(VentanillasJdbc::ventanilla).optional();
    }

    @Override
    public List<Ventanilla> delLocal(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM ventanilla WHERE local_id = :local ORDER BY id")
                .param("local", localId).query(VentanillasJdbc::ventanilla).list();
    }

    @Override
    public List<Ventanilla> activasDelLocal(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM ventanilla WHERE local_id = :local AND activa ORDER BY id")
                .param("local", localId).query(VentanillasJdbc::ventanilla).list();
    }

    @Override
    public int contar(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM ventanilla WHERE local_id = :local").param("local", localId).query(Integer.class).single();
    }

    @Override
    public int contarTurnos(int ventanillaId) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE ventanilla_id = :v").param("v", ventanillaId).query(Integer.class).single();
    }

    @Override
    public int crear(int localId, String nombre, Integer colaId, boolean activa) {
        return jdbc.sql("INSERT INTO ventanilla (local_id, nombre, cola_id, activa) VALUES (:local, :nombre, :cola, :activa) RETURNING id")
                .param("local", localId).param("nombre", nombre).param("cola", colaId).param("activa", activa)
                .query(Integer.class).single();
    }

    @Override
    public void actualizar(Ventanilla v) {
        jdbc.sql("UPDATE ventanilla SET nombre = :nombre, cola_id = :cola, activa = :activa WHERE id = :id")
                .param("nombre", v.nombre()).param("cola", v.colaId()).param("activa", v.activa()).param("id", v.id())
                .update();
    }

    @Override
    public void eliminar(int id) {
        jdbc.sql("DELETE FROM ventanilla WHERE id = :id").param("id", id).update();
    }

    private static Ventanilla ventanilla(ResultSet rs, int fila) throws SQLException {
        return new Ventanilla(rs.getInt("id"), rs.getInt("local_id"), rs.getString("nombre"), Sql.entero(rs, "cola_id"), rs.getBoolean("activa"));
    }
}
