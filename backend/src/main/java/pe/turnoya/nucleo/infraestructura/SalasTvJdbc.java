package pe.turnoya.nucleo.infraestructura;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.dominio.RepositorioSalasTv;

/** Acceso a la tabla {@code sala_tv}. */
@Repository
class SalasTvJdbc implements RepositorioSalasTv {

    private final JdbcClient jdbc;

    SalasTvJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<SalaTv> delLocal(int localId) {
        return jdbc.sql("SELECT id, local_id, nombre, cola_ids, created_at FROM sala_tv WHERE local_id = :local ORDER BY id")
                .param("local", localId).query(SalasTvJdbc::fila).list();
    }

    @Override
    public Optional<SalaTv> porId(int localId, int id) {
        return jdbc.sql("SELECT id, local_id, nombre, cola_ids, created_at FROM sala_tv WHERE local_id = :local AND id = :id")
                .param("local", localId).param("id", id).query(SalasTvJdbc::fila).optional();
    }

    @Override
    public int crear(int localId, String nombre, List<Integer> colaIds) {
        String arreglo = colaIds.stream().map(String::valueOf).collect(Collectors.joining(",", "{", "}"));
        return jdbc.sql("INSERT INTO sala_tv (local_id, nombre, cola_ids) VALUES (:local, :nombre, CAST(:colas AS int[])) RETURNING id")
                .param("local", localId).param("nombre", nombre).param("colas", arreglo).query(Integer.class).single();
    }

    @Override
    public void eliminar(int localId, int id) {
        jdbc.sql("DELETE FROM sala_tv WHERE local_id = :local AND id = :id").param("local", localId).param("id", id).update();
    }

    private static SalaTv fila(ResultSet rs, int n) throws SQLException {
        return new SalaTv(rs.getInt("id"), rs.getInt("local_id"), rs.getString("nombre"), enteros(rs.getArray("cola_ids")),
                Sql.instante(rs, "created_at"));
    }

    private static List<Integer> enteros(Array a) throws SQLException {
        if (a == null) {
            return List.of();
        }
        return Arrays.stream((Object[]) a.getArray()).map(x -> ((Number) x).intValue()).toList();
    }
}
