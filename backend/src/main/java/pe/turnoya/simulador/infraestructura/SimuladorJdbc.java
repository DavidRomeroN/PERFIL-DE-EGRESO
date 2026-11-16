package pe.turnoya.simulador.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.simulador.dominio.RepositorioSimulador;

/** Adaptador JDBC del simulador (tablas {@code turno}, {@code cola} y {@code escenario_simulacion}). */
@Repository
class SimuladorJdbc implements RepositorioSimulador {

    private final JdbcClient jdbc;

    SimuladorJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Cola> colas(int localId) {
        return jdbc.sql("SELECT id, nombre, tiempo_atencion_base FROM cola WHERE local_id = :local AND activa ORDER BY orden, id")
                .param("local", localId).query(SimuladorJdbc::cola).list();
    }

    @Override
    public Optional<Cola> cola(int localId, int colaId) {
        return jdbc.sql("SELECT id, nombre, tiempo_atencion_base FROM cola WHERE local_id = :local AND id = :id")
                .param("local", localId).param("id", colaId).query(SimuladorJdbc::cola).optional();
    }

    private static Cola cola(ResultSet rs, int n) throws SQLException {
        return new Cola(rs.getInt("id"), rs.getString("nombre"), rs.getInt("tiempo_atencion_base"));
    }

    @Override
    public List<TurnoHistorico> turnos(int colaId, LocalDate desde, LocalDate hasta) {
        return jdbc.sql("""
                        SELECT fecha, emitido_at, llamado_at, finalizado_at, estado::text AS estado, ventanilla_id,
                               transferido_de_turno_id IS NOT NULL AS transferido
                          FROM turno WHERE cola_id = :cola AND fecha >= :desde AND fecha < :hasta""")
                .param("cola", colaId).param("desde", desde).param("hasta", hasta)
                .query((rs, n) -> new TurnoHistorico(Sql.fecha(rs, "fecha"), Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at"),
                        Sql.instante(rs, "finalizado_at"), rs.getString("estado"), Sql.entero(rs, "ventanilla_id"), rs.getBoolean("transferido")))
                .list();
    }

    private static final String COLUMNAS_ESCENARIO = """
            id, nombre, cola_id, semilla, created_at, parametros::text AS parametros,
            CAST(resultados ->> 'pctSla' AS double precision) AS pct_sla, CAST(resultados ->> 'esperaMedia' AS double precision) AS espera_media""";

    @Override
    public List<Escenario> escenarios(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS_ESCENARIO + " FROM escenario_simulacion WHERE local_id = :local ORDER BY created_at DESC, id DESC")
                .param("local", localId).query(SimuladorJdbc::escenario).list();
    }

    @Override
    public Optional<Escenario> escenario(int localId, int id) {
        return jdbc.sql("SELECT " + COLUMNAS_ESCENARIO + " FROM escenario_simulacion WHERE local_id = :local AND id = :id")
                .param("local", localId).param("id", id).query(SimuladorJdbc::escenario).optional();
    }

    private static Escenario escenario(ResultSet rs, int n) throws SQLException {
        double pct = rs.getDouble("pct_sla");
        Double pctSla = rs.wasNull() ? null : pct;
        double espera = rs.getDouble("espera_media");
        Double esperaMedia = rs.wasNull() ? null : espera;
        return new Escenario(rs.getInt("id"), rs.getString("nombre"), Sql.entero(rs, "cola_id"), rs.getInt("semilla"), Sql.instante(rs, "created_at"),
                rs.getString("parametros"), pctSla, esperaMedia);
    }

    @Override
    public int contarEscenarios(int localId) {
        return jdbc.sql("SELECT count(*) FROM escenario_simulacion WHERE local_id = :local").param("local", localId).query(Integer.class).single();
    }

    @Override
    public int crearEscenario(int localId, String nombre, Integer colaId, String parametrosJson, String resultadosJson, int semilla, Integer usuarioId) {
        return jdbc.sql("""
                        INSERT INTO escenario_simulacion (local_id, cola_id, nombre, parametros, resultados, semilla, created_by)
                        VALUES (:local, :cola, :nombre, CAST(:parametros AS jsonb), CAST(:resultados AS jsonb), :semilla, :usuario) RETURNING id""")
                .param("local", localId).param("cola", colaId).param("nombre", nombre).param("parametros", parametrosJson)
                .param("resultados", resultadosJson).param("semilla", semilla).param("usuario", usuarioId)
                .query(Integer.class).single();
    }

    @Override
    public boolean eliminarEscenario(int localId, int id) {
        return jdbc.sql("DELETE FROM escenario_simulacion WHERE local_id = :local AND id = :id").param("local", localId).param("id", id).update() == 1;
    }
}
