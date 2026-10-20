package pe.turnoya.nucleo.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.CanalTurno;
import pe.turnoya.nucleo.EstadoTurno;
import pe.turnoya.nucleo.dominio.Turno;

/**
 * Acceso a la tabla {@code turno}. La selección del siguiente turno y la numeración viven en funciones SQL
 * ({@code siguiente_turno} con {@code FOR UPDATE SKIP LOCKED}, {@code emitir_turno}): aquí solo se llaman.
 */
@Repository
public class TurnosJdbc {

    static final String COLUMNAS = """
            t.id, t.local_id, t.cola_id, t.numero, t.codigo, t.token, t.cliente_id, t.estado::text AS estado, t.ventanilla_id,
            t.canal::text AS canal, t.rellamadas, t.emitido_at, t.avisado_at, t.llamado_at, t.atendido_at, t.finalizado_at, t.fecha,
            t.categoria_id, t.prioridad_verificada, t.cita_id, t.codigo_provisional, t.sucesor_id, t.aviso_min_antes""";

    private static final String ORDEN_FILA = "t.clave_orden DESC, t.emitido_at ASC, t.id ASC";

    private final JdbcClient jdbc;

    public TurnosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Turno> porToken(String token) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.token = :token")
                .param("token", token).query(TurnosJdbc::turno).optional();
    }

    public Optional<Turno> porId(int id) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.id = :id")
                .param("id", id).query(TurnosJdbc::turno).optional();
    }

    public Optional<Turno> porIdEnLocal(int id, int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.id = :id AND t.local_id = :local")
                .param("id", id).param("local", localId).query(TurnosJdbc::turno).optional();
    }

    /** Llama a {@code emitir_turno} (numeración diaria por cola, clave de prioridad y contexto para M2). */
    public int emitir(int colaId, Integer clienteId, CanalTurno canal, String token, LocalDate fecha, Integer categoriaId,
                      Instant emitidoAt, String origenJson) {
        return jdbc.sql("""
                        SELECT id FROM emitir_turno(CAST(:cola AS int), CAST(:cliente AS int), CAST(:canal AS text), CAST(:token AS text),
                                                    CAST(:fecha AS date), CAST(:categoria AS int), CAST(:emitido AS timestamp),
                                                    CAST(:origen AS jsonb))""")
                .param("cola", colaId)
                .param("cliente", clienteId)
                .param("canal", canal.name())
                .param("token", token)
                .param("fecha", fecha)
                .param("categoria", categoriaId)
                .param("emitido", Sql.utc(emitidoAt))
                .param("origen", origenJson)
                .query(Integer.class)
                .single();
    }

    public void marcarPrioridadVerificada(int id) {
        jdbc.sql("UPDATE turno SET prioridad_verificada = true WHERE id = :id").param("id", id).update();
    }

    /** RN05: turnos emitidos en el mes (las transferencias no cuentan). */
    public int contarDesde(int localId, LocalDate desde) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE local_id = :local AND fecha >= :desde AND transferido_de_turno_id IS NULL")
                .param("local", localId).param("desde", desde).query(Integer.class).single();
    }

    /** RN03: turno activo del cliente en la cola. */
    public Optional<CodigoYToken> activoDeCliente(int colaId, int clienteId) {
        return jdbc.sql("""
                        SELECT codigo, token FROM turno
                         WHERE cola_id = :cola AND cliente_id = :cliente AND estado IN ('EMITIDO', 'AVISADO', 'LLAMADO')
                         LIMIT 1""")
                .param("cola", colaId).param("cliente", clienteId)
                .query((rs, i) -> new CodigoYToken(rs.getString("codigo"), rs.getString("token")))
                .optional();
    }

    public int posicion(int turnoId) {
        return jdbc.sql("SELECT posicion_turno(CAST(:id AS int))").param("id", turnoId).query(Integer.class).optional().orElse(1);
    }

    public int tiempoEstimadoBase(int colaId, int posicion) {
        return jdbc.sql("SELECT tiempo_estimado(CAST(:cola AS int), CAST(:pos AS int))")
                .param("cola", colaId).param("pos", posicion).query(Integer.class).optional().orElse(0);
    }

    public int enEspera(int colaId, LocalDate fecha) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE cola_id = :cola AND fecha = :fecha AND estado IN ('EMITIDO', 'AVISADO')")
                .param("cola", colaId).param("fecha", fecha).query(Integer.class).single();
    }

    /** Los primeros {@code limite} en espera de la cola, en el orden en que serán llamados. */
    public List<Turno> primerosEnEspera(int colaId, LocalDate fecha, int limite) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.cola_id = :cola AND t.fecha = :fecha"
                        + " AND t.estado IN ('EMITIDO', 'AVISADO') ORDER BY " + ORDEN_FILA + " LIMIT :limite")
                .param("cola", colaId).param("fecha", fecha).param("limite", limite)
                .query(TurnosJdbc::turno).list();
    }

    /** Todos los turnos del día del local con los datos que muestran el panel y la TV. */
    public List<TurnoDelDia> delDia(int localId, LocalDate fecha) {
        return jdbc.sql("SELECT " + COLUMNAS + """
                        , c.nombre AS cliente_nombre, v.nombre AS ventanilla_nombre, cp.nombre AS categoria_nombre, cp.codigo AS categoria_codigo
                          FROM turno t
                          LEFT JOIN cliente c ON c.id = t.cliente_id
                          LEFT JOIN ventanilla v ON v.id = t.ventanilla_id
                          LEFT JOIN categoria_prioridad cp ON cp.id = t.categoria_id
                         WHERE t.local_id = :local AND t.fecha = :fecha
                         ORDER BY """ + " " + ORDEN_FILA)
                .param("local", localId).param("fecha", fecha)
                .query((rs, i) -> new TurnoDelDia(turno(rs, i), rs.getString("cliente_nombre"), rs.getString("ventanilla_nombre"),
                        rs.getString("categoria_nombre"), rs.getString("categoria_codigo")))
                .list();
    }

    public List<LlamadoEnCola> llamandoAhora(int colaId, LocalDate fecha) {
        return jdbc.sql("""
                        SELECT t.codigo, t.codigo_provisional, v.nombre AS ventanilla FROM turno t LEFT JOIN ventanilla v ON v.id = t.ventanilla_id
                         WHERE t.cola_id = :cola AND t.fecha = :fecha AND t.estado = 'LLAMADO'
                         ORDER BY t.llamado_at DESC LIMIT 3""")
                .param("cola", colaId).param("fecha", fecha)
                .query((rs, i) -> new LlamadoEnCola(rs.getString("codigo"), rs.getString("codigo_provisional"),
                        rs.getString("ventanilla") == null ? "" : rs.getString("ventanilla")))
                .list();
    }

    public Optional<Turno> llamadoEnVentanilla(int ventanillaId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.ventanilla_id = :v AND t.estado = 'LLAMADO' LIMIT 1")
                .param("v", ventanillaId).query(TurnosJdbc::turno).optional();
    }

    /** Elige el siguiente turno (prioridad, antigüedad y tope de adelantos) y lo bloquea dentro de la transacción. */
    public Optional<Integer> siguiente(int localId, Integer colaId, LocalDate fecha) {
        // La función devuelve NULL si no hay nadie en espera
        return jdbc.sql("SELECT siguiente_turno(CAST(:local AS int), CAST(:cola AS int), CAST(:fecha AS date))")
                .param("local", localId).param("cola", colaId).param("fecha", fecha)
                .query(Integer.class).list().stream().filter(java.util.Objects::nonNull).findFirst();
    }

    public void marcarLlamado(int id, int ventanillaId, Instant ahora) {
        jdbc.sql("""
                        UPDATE turno SET estado = 'LLAMADO', ventanilla_id = :v, llamado_at = :ahora, avisado_at = COALESCE(avisado_at, :ahora)
                         WHERE id = :id""")
                .param("v", ventanillaId).param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    /**
     * Cambia el estado solo si el turno sigue en {@code desde} (guarda optimista: si otro proceso lo cambió, por
     * ejemplo la expiración RN04, no se pisa). Ajusta las fechas y el contador de rellamadas según el destino.
     */
    public boolean transicionar(int id, EstadoTurno desde, EstadoTurno hacia, Instant ahora) {
        return jdbc.sql("""
                        UPDATE turno SET
                               estado = CAST(:hacia AS "EstadoTurno"),
                               rellamadas = rellamadas + CASE WHEN :hacia = 'LLAMADO' THEN 1 ELSE 0 END,
                               llamado_at = CASE WHEN :hacia = 'LLAMADO' THEN :ahora ELSE llamado_at END,
                               avisado_at = CASE WHEN :hacia = 'AVISADO' THEN :ahora ELSE avisado_at END,
                               atendido_at = CASE WHEN :hacia = 'ATENDIDO' THEN COALESCE(atendido_at, :ahora) ELSE atendido_at END,
                               finalizado_at = CASE WHEN :hacia IN ('ATENDIDO', 'NO_SE_PRESENTO', 'CANCELADO') THEN :ahora ELSE finalizado_at END
                         WHERE id = :id AND estado = CAST(:desde AS "EstadoTurno")""")
                .param("hacia", hacia.name())
                .param("desde", desde.name())
                .param("ahora", Sql.utc(ahora))
                .param("id", id)
                .update() == 1;
    }

    /** RN04: llamados que superaron el tiempo de presentación del local. */
    public List<Turno> llamadosVencidos(int localId, Instant limite) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t WHERE t.local_id = :local AND t.estado = 'LLAMADO' AND t.llamado_at <= :limite")
                .param("local", localId).param("limite", Sql.utc(limite)).query(TurnosJdbc::turno).list();
    }

    public Optional<Sucesor> sucesor(int sucesorId) {
        return jdbc.sql("SELECT t.token, t.codigo, c.nombre AS cola FROM turno t JOIN cola c ON c.id = t.cola_id WHERE t.id = :id")
                .param("id", sucesorId)
                .query((rs, i) -> new Sucesor(rs.getString("token"), rs.getString("codigo"), rs.getString("cola")))
                .optional();
    }

    /** Historial del operador (N02): página de 50 por id descendente. */
    public List<FilaHistorial> historial(int localId, LocalDate fecha, Integer ventanillaId, EstadoTurno estado, Integer cursor) {
        return jdbc.sql("""
                        SELECT t.id, t.codigo, t.codigo_provisional, t.estado::text AS estado, t.canal::text AS canal, t.emitido_at,
                               t.llamado_at, t.finalizado_at, t.rellamadas, co.nombre AS cola, v.nombre AS ventanilla, c.nombre AS cliente
                          FROM turno t
                          JOIN cola co ON co.id = t.cola_id
                          LEFT JOIN ventanilla v ON v.id = t.ventanilla_id
                          LEFT JOIN cliente c ON c.id = t.cliente_id
                         WHERE t.local_id = :local AND t.fecha = :fecha
                           AND (CAST(:ventanilla AS int) IS NULL OR t.ventanilla_id = :ventanilla)
                           AND (CAST(:estado AS text) IS NULL OR t.estado::text = :estado)
                           AND (CAST(:cursor AS int) IS NULL OR t.id < :cursor)
                         ORDER BY t.id DESC LIMIT 50""")
                .param("local", localId).param("fecha", fecha).param("ventanilla", ventanillaId)
                .param("estado", estado == null ? null : estado.name()).param("cursor", cursor)
                .query((rs, i) -> new FilaHistorial(rs.getInt("id"), rs.getString("codigo"), rs.getString("codigo_provisional"),
                        EstadoTurno.valueOf(rs.getString("estado")), CanalTurno.valueOf(rs.getString("canal")),
                        Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at"), Sql.instante(rs, "finalizado_at"),
                        rs.getInt("rellamadas"), rs.getString("cola"), rs.getString("ventanilla"), rs.getString("cliente")))
                .list();
    }

    /** Tiempos del día para los KPI del historial. */
    public List<Turno> delDiaFiltrado(int localId, LocalDate fecha, Integer ventanillaId, EstadoTurno estado) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM turno t " + """
                         WHERE t.local_id = :local AND t.fecha = :fecha
                          AND (CAST(:ventanilla AS int) IS NULL OR t.ventanilla_id = :ventanilla)
                          AND (CAST(:estado AS text) IS NULL OR t.estado::text = :estado)""")
                .param("local", localId).param("fecha", fecha).param("ventanilla", ventanillaId)
                .param("estado", estado == null ? null : estado.name())
                .query(TurnosJdbc::turno).list();
    }

    static Turno turno(ResultSet rs, int fila) throws SQLException {
        return new Turno(
                rs.getInt("id"),
                rs.getInt("local_id"),
                rs.getInt("cola_id"),
                rs.getInt("numero"),
                rs.getString("codigo"),
                rs.getString("token"),
                Sql.entero(rs, "cliente_id"),
                EstadoTurno.valueOf(rs.getString("estado")),
                Sql.entero(rs, "ventanilla_id"),
                CanalTurno.valueOf(rs.getString("canal")),
                rs.getInt("rellamadas"),
                Sql.instante(rs, "emitido_at"),
                Sql.instante(rs, "avisado_at"),
                Sql.instante(rs, "llamado_at"),
                Sql.instante(rs, "atendido_at"),
                Sql.instante(rs, "finalizado_at"),
                Sql.fecha(rs, "fecha"),
                Sql.entero(rs, "categoria_id"),
                Sql.booleano(rs, "prioridad_verificada"),
                Sql.entero(rs, "cita_id"),
                rs.getString("codigo_provisional"),
                Sql.entero(rs, "sucesor_id"),
                Sql.entero(rs, "aviso_min_antes"));
    }

    public record CodigoYToken(String codigo, String token) {
    }

    public record TurnoDelDia(Turno turno, String clienteNombre, String ventanillaNombre, String categoriaNombre, String categoriaCodigo) {
    }

    public record LlamadoEnCola(String codigo, String codigoProvisional, String ventanilla) {
    }

    public record Sucesor(String token, String codigo, String cola) {
    }

    public record FilaHistorial(int id, String codigo, String codigoProvisional, EstadoTurno estado, CanalTurno canal, Instant emitidoAt,
                                Instant llamadoAt, Instant finalizadoAt, int rellamadas, String cola, String ventanilla, String cliente) {
    }
}
