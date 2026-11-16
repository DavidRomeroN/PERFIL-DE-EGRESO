package pe.turnoya.balanceo.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.balanceo.dominio.RepositorioBalanceo;
import pe.turnoya.compartido.datos.Sql;

/** Acceso a las tablas de M6 y a las lecturas/acciones de balanceo sobre {@code turno}, {@code ventanilla} y {@code config_prioridad}. */
@Repository
class BalanceoJdbc implements RepositorioBalanceo {

    private static final String REGLA = """
            SELECT r.id, r.local_id, r.nombre, r.activa, r.modo, r.condicion::text AS condicion, r.accion::text AS accion, r.for_segundos,
                   r.for_segundos_reversa, r.cooldown_seg, r.histeresis_pct, r.ttl_seg, r.requiere_confirmacion, r.prioridad, r.created_at,
                   e.regla_id AS e_id, e.fase, e.verdadera_desde, e.falsa_desde, e.ultima_ejecucion_at, e.estado_accion::text AS estado_accion
              FROM regla_balanceo r LEFT JOIN regla_estado e ON e.regla_id = r.id
            """;

    private static final String ORDEN = " ORDER BY r.prioridad, r.id";

    private final JdbcClient jdbc;

    BalanceoJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // --- Reglas ---

    @Override
    public List<Regla> reglas(int localId) {
        return jdbc.sql(REGLA + " WHERE r.local_id = :local" + ORDEN).param("local", localId).query(BalanceoJdbc::regla).list();
    }

    @Override
    public List<Regla> activas(int localId) {
        return jdbc.sql(REGLA + " WHERE r.local_id = :local AND r.activa" + ORDEN).param("local", localId).query(BalanceoJdbc::regla).list();
    }

    @Override
    public Optional<Regla> regla(int id, int localId) {
        return jdbc.sql(REGLA + " WHERE r.id = :id AND r.local_id = :local").param("id", id).param("local", localId).query(BalanceoJdbc::regla).optional();
    }

    @Override
    public int contarReglas(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM regla_balanceo WHERE local_id = ?").param(localId).query(Integer.class).single();
    }

    @Override
    public int crear(int localId, DatosRegla d, Integer creadoPor) {
        // RN-M6-09: toda regla nace en SIMULACION
        return jdbc.sql("""
                        INSERT INTO regla_balanceo (local_id, nombre, activa, modo, condicion, accion, for_segundos, for_segundos_reversa, cooldown_seg,
                                                    histeresis_pct, ttl_seg, requiere_confirmacion, prioridad, created_by)
                        VALUES (:local, :nombre, true, 'SIMULACION', CAST(:cond AS jsonb), CAST(:acc AS jsonb), :for, :forRev, :cooldown, :hist,
                                CAST(:ttl AS int), :conf, :prio, CAST(:por AS int))
                        RETURNING id""")
                .param("local", localId).param("nombre", d.nombre()).param("cond", d.condicionJson()).param("acc", d.accionJson())
                .param("for", d.forSegundos()).param("forRev", d.forSegundosReversa()).param("cooldown", d.cooldownSeg())
                .param("hist", d.histeresisPct()).param("ttl", d.ttlSeg()).param("conf", d.requiereConfirmacion()).param("prio", d.prioridad())
                .param("por", creadoPor)
                .query(Integer.class).single();
    }

    @Override
    public void actualizar(int id, DatosRegla d, boolean activa, String modo) {
        jdbc.sql("""
                        UPDATE regla_balanceo SET nombre = :nombre, condicion = CAST(:cond AS jsonb), accion = CAST(:acc AS jsonb), for_segundos = :for,
                               for_segundos_reversa = :forRev, cooldown_seg = :cooldown, histeresis_pct = :hist, ttl_seg = CAST(:ttl AS int),
                               requiere_confirmacion = :conf, prioridad = :prio, activa = :activa, modo = :modo
                         WHERE id = :id""")
                .param("nombre", d.nombre()).param("cond", d.condicionJson()).param("acc", d.accionJson())
                .param("for", d.forSegundos()).param("forRev", d.forSegundosReversa()).param("cooldown", d.cooldownSeg())
                .param("hist", d.histeresisPct()).param("ttl", d.ttlSeg()).param("conf", d.requiereConfirmacion()).param("prio", d.prioridad())
                .param("activa", activa).param("modo", modo).param("id", id)
                .update();
    }

    @Override
    public void eliminar(int id) {
        jdbc.sql("DELETE FROM regla_balanceo WHERE id = ?").param(id).update();
    }

    @Override
    public void borrarEstado(int reglaId) {
        jdbc.sql("DELETE FROM regla_estado WHERE regla_id = ?").param(reglaId).update();
    }

    @Override
    public void guardarEstado(int reglaId, String fase, Instant verdaderaDesde, Instant falsaDesde, Instant ultimaEjecucionAt, String estadoAccionJson) {
        jdbc.sql("""
                        INSERT INTO regla_estado (regla_id, fase, verdadera_desde, falsa_desde, ultima_ejecucion_at, estado_accion)
                        VALUES (:id, :fase, CAST(:vd AS timestamp), CAST(:fd AS timestamp), CAST(:ue AS timestamp), CAST(:ea AS jsonb))
                        ON CONFLICT (regla_id) DO UPDATE SET fase = EXCLUDED.fase, verdadera_desde = EXCLUDED.verdadera_desde,
                               falsa_desde = EXCLUDED.falsa_desde, ultima_ejecucion_at = EXCLUDED.ultima_ejecucion_at, estado_accion = EXCLUDED.estado_accion""")
                .param("id", reglaId).param("fase", fase).param("vd", utc(verdaderaDesde)).param("fd", utc(falsaDesde))
                .param("ue", utc(ultimaEjecucionAt)).param("ea", estadoAccionJson)
                .update();
    }

    @Override
    public List<Integer> localesConReglasActivas() {
        return jdbc.sql("SELECT DISTINCT local_id FROM regla_balanceo WHERE activa ORDER BY local_id").query(Integer.class).list();
    }

    @Override
    public boolean candado(int localId) {
        return Boolean.TRUE.equals(jdbc.sql("SELECT pg_try_advisory_xact_lock(hashtext(:clave))").param("clave", "balanceo:" + localId)
                .query(Boolean.class).single());
    }

    // --- Ejecuciones ---

    @Override
    public long registrarEjecucion(int reglaId, int localId, String fase, String metricasJson, String resultado, String detalleJson) {
        return jdbc.sql("""
                        INSERT INTO ejecucion_regla (regla_id, local_id, fase, metricas, resultado, detalle)
                        VALUES (:regla, :local, :fase, CAST(:met AS jsonb), :res, CAST(:det AS jsonb)) RETURNING id""")
                .param("regla", reglaId).param("local", localId).param("fase", fase).param("met", metricasJson).param("res", resultado)
                .param("det", detalleJson)
                .query(Long.class).single();
    }

    @Override
    public int ejecutadasDesde(int localId, Instant desde) {
        return jdbc.sql("SELECT COUNT(*) FROM ejecucion_regla WHERE local_id = :local AND resultado = 'EJECUTADA' AND ts >= :desde")
                .param("local", localId).param("desde", Sql.utc(desde)).query(Integer.class).single();
    }

    private static final String EJECUCION = """
            SELECT e.id, e.regla_id, r.nombre AS regla, e.ts, e.fase, e.resultado, e.detalle::text AS detalle, e.confirmada_por
              FROM ejecucion_regla e JOIN regla_balanceo r ON r.id = e.regla_id
            """;

    @Override
    public List<Ejecucion> ejecuciones(int localId, Integer reglaId, String resultado, Long cursor, int limite) {
        return jdbc.sql(EJECUCION + """
                         WHERE e.local_id = :local AND (CAST(:regla AS int) IS NULL OR e.regla_id = :regla)
                           AND (CAST(:res AS text) IS NULL OR e.resultado = :res) AND (CAST(:cursor AS bigint) IS NULL OR e.id < :cursor)
                         ORDER BY e.id DESC LIMIT :limite
                        """)
                .param("local", localId).param("regla", reglaId).param("res", resultado).param("cursor", cursor).param("limite", limite)
                .query(BalanceoJdbc::ejecucion).list();
    }

    @Override
    public Optional<Ejecucion> ejecucion(long id, int localId) {
        return jdbc.sql(EJECUCION + " WHERE e.id = :id AND e.local_id = :local").param("id", id).param("local", localId)
                .query(BalanceoJdbc::ejecucion).optional();
    }

    @Override
    public void resolverEjecucion(long id, String resultado, Integer confirmadaPor, String detalleJson) {
        jdbc.sql("""
                        UPDATE ejecucion_regla SET resultado = :res, confirmada_por = CAST(:por AS int),
                               detalle = COALESCE(CAST(:det AS jsonb), detalle) WHERE id = :id""")
                .param("res", resultado).param("por", confirmadaPor).param("det", detalleJson).param("id", id).update();
    }

    @Override
    public int borrarEjecucionesAntesDe(Instant limite) {
        return jdbc.sql("DELETE FROM ejecucion_regla WHERE ts < :limite").param("limite", Sql.utc(limite)).update();
    }

    // --- Métricas y carga (§6.2, una sola consulta) ---

    @Override
    public List<FilaCarga> carga(int localId, LocalDate fecha, Instant ahora) {
        return jdbc.sql("""
                        WITH t AS (SELECT * FROM turno WHERE local_id = :local AND fecha = :fecha)
                        SELECT c.id AS cola_id, c.nombre,
                               (SELECT COUNT(*) FROM t WHERE t.cola_id = c.id AND t.estado IN ('EMITIDO','AVISADO'))::int AS en_espera,
                               (SELECT EXTRACT(EPOCH FROM (CAST(:ahora AS timestamp) - MIN(t.emitido_at))) / 60 FROM t
                                 WHERE t.cola_id = c.id AND t.estado IN ('EMITIDO','AVISADO')) AS espera_max_min,
                               (SELECT AVG(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at))) / 60 FROM t
                                 WHERE t.cola_id = c.id AND t.llamado_at >= CAST(:hace15 AS timestamp)) AS espera_prom_min,
                               (SELECT COUNT(DISTINCT t.ventanilla_id) FROM t WHERE t.cola_id = c.id AND t.ventanilla_id IS NOT NULL
                                   AND (t.estado = 'LLAMADO' OR t.llamado_at >= CAST(:hace15 AS timestamp)))::int AS operativas,
                               (SELECT COUNT(DISTINCT t.ventanilla_id) FROM t WHERE t.cola_id = c.id AND t.estado = 'LLAMADO')::int AS ocupadas,
                               (SELECT COUNT(*) FROM t WHERE t.cola_id = c.id AND t.emitido_at >= CAST(:hace15 AS timestamp))::int AS llegadas,
                               (SELECT COUNT(*) FROM ventanilla v WHERE v.cola_id = c.id AND v.activa)::int AS ventanillas_activas
                          FROM cola c WHERE c.local_id = :local AND c.activa ORDER BY c.orden, c.id
                        """)
                .param("local", localId).param("fecha", fecha).param("ahora", Sql.utc(ahora)).param("hace15", Sql.utc(ahora.minusSeconds(900)))
                .query((rs, i) -> new FilaCarga(rs.getInt("cola_id"), rs.getString("nombre"), rs.getInt("en_espera"), doble(rs, "espera_max_min"),
                        doble(rs, "espera_prom_min"), rs.getInt("operativas"), rs.getInt("ocupadas"), rs.getInt("llegadas"), rs.getInt("ventanillas_activas")))
                .list();
    }

    @Override
    public List<VentanillaCarga> ventanillas(int localId, LocalDate fecha) {
        return jdbc.sql("""
                        SELECT v.id, v.nombre, v.activa, COALESCE(c.nombre, 'Todas') AS cola, v.cola_original_id,
                               (SELECT COUNT(*) FROM turno t WHERE t.ventanilla_id = v.id AND t.fecha = :fecha AND t.estado = 'ATENDIDO')::int AS atendidos,
                               (SELECT t.codigo FROM turno t WHERE t.ventanilla_id = v.id AND t.estado = 'LLAMADO' LIMIT 1) AS atendiendo
                          FROM ventanilla v LEFT JOIN cola c ON c.id = v.cola_id
                         WHERE v.local_id = :local ORDER BY v.id
                        """)
                .param("local", localId).param("fecha", fecha)
                .query((rs, i) -> new VentanillaCarga(rs.getInt("id"), rs.getString("nombre"), rs.getBoolean("activa"), rs.getString("cola"),
                        rs.getInt("atendidos"), rs.getString("atendiendo"), rs.getObject("cola_original_id") != null))
                .list();
    }

    @Override
    public Map<Integer, String> colas(int localId) {
        Map<Integer, String> m = new LinkedHashMap<>();
        jdbc.sql("SELECT id, nombre FROM cola WHERE local_id = ? ORDER BY orden, id").param(localId)
                .query((rs, i) -> m.put(rs.getInt("id"), rs.getString("nombre"))).list();
        return m;
    }

    @Override
    public Map<Integer, String> nombresVentanillas(int localId) {
        Map<Integer, String> m = new LinkedHashMap<>();
        jdbc.sql("SELECT id, nombre FROM ventanilla WHERE local_id = ? ORDER BY id").param(localId)
                .query((rs, i) -> m.put(rs.getInt("id"), rs.getString("nombre"))).list();
        return m;
    }

    // --- Acciones ---

    private static final String VENTANILLA = "SELECT v.id, v.nombre, v.cola_id, v.activa, v.cola_original_id, v.regla_asignadora_id FROM ventanilla v ";

    @Override
    public Optional<VentanillaM6> ventanilla(int id, int localId) {
        return jdbc.sql(VENTANILLA + "WHERE v.id = :id AND v.local_id = :local").param("id", id).param("local", localId)
                .query(BalanceoJdbc::ventanilla).optional();
    }

    @Override
    public Optional<VentanillaM6> ventanillaLibre(int localId, int colaId, Integer ventanillaId, boolean soloSinRegla) {
        return jdbc.sql(VENTANILLA + """
                        WHERE v.local_id = :local AND v.activa AND v.cola_id = :cola
                          AND (CAST(:v AS int) IS NULL OR v.id = :v) AND (NOT :sinRegla OR v.regla_asignadora_id IS NULL)
                          AND NOT EXISTS (SELECT 1 FROM turno t WHERE t.ventanilla_id = v.id AND t.estado = 'LLAMADO')
                        ORDER BY v.id DESC LIMIT 1
                        """)
                .param("local", localId).param("cola", colaId).param("v", ventanillaId).param("sinRegla", soloSinRegla)
                .query(BalanceoJdbc::ventanilla).optional();
    }

    @Override
    public void abrirVentanilla(int id, Integer colaId, Integer colaOriginalId, int reglaId) {
        jdbc.sql("""
                        UPDATE ventanilla SET activa = true, cola_id = COALESCE(CAST(:cola AS int), cola_id),
                               cola_original_id = CASE WHEN CAST(:cola AS int) IS NULL THEN cola_original_id ELSE CAST(:orig AS int) END,
                               regla_asignadora_id = :regla
                         WHERE id = :id""")
                .param("cola", colaId).param("orig", colaOriginalId).param("regla", reglaId).param("id", id).update();
    }

    @Override
    public void moverVentanilla(int id, int haciaColaId, Integer colaOriginalId, Integer reglaId) {
        jdbc.sql("""
                        UPDATE ventanilla SET cola_id = :hacia, cola_original_id = CAST(:orig AS int), regla_asignadora_id = CAST(:regla AS int)
                         WHERE id = :id""")
                .param("hacia", haciaColaId).param("orig", colaOriginalId).param("regla", reglaId).param("id", id).update();
    }

    @Override
    public void revertirMovimiento(int id, int localId, int reglaId, int colaOriginal) {
        jdbc.sql("""
                        UPDATE ventanilla SET cola_id = :cola, cola_original_id = NULL, regla_asignadora_id = NULL
                         WHERE id = :id AND local_id = :local AND regla_asignadora_id = :regla""")
                .param("cola", colaOriginal).param("id", id).param("local", localId).param("regla", reglaId).update();
    }

    @Override
    public void revertirApertura(int id, int localId, int reglaId, boolean estabaActiva, Integer colaAnterior) {
        jdbc.sql("""
                        UPDATE ventanilla SET activa = :activa, cola_id = COALESCE(CAST(:cola AS int), cola_id), cola_original_id = NULL,
                               regla_asignadora_id = NULL
                         WHERE id = :id AND local_id = :local AND regla_asignadora_id = :regla""")
                .param("activa", estabaActiva).param("cola", colaAnterior).param("id", id).param("local", localId).param("regla", reglaId).update();
    }

    @Override
    public List<Integer> ultimosEnEspera(int localId, int colaId, int cantidad) {
        return jdbc.sql("""
                        SELECT id FROM turno WHERE local_id = :local AND cola_id = :cola AND estado IN ('EMITIDO','AVISADO')
                         ORDER BY clave_orden ASC, emitido_at DESC LIMIT :n
                        """)
                .param("local", localId).param("cola", colaId).param("n", cantidad).query(Integer.class).list();
    }

    @Override
    public double alfa(int localId) {
        return jdbc.sql("SELECT alfa_puntos_por_min FROM config_prioridad WHERE local_id = ?").param(localId).query(Double.class).optional()
                .orElse(1.5);
    }

    @Override
    public void fijarAlfa(int localId, double alfa) {
        jdbc.sql("""
                        INSERT INTO config_prioridad (local_id, alfa_puntos_por_min) VALUES (:local, :alfa)
                        ON CONFLICT (local_id) DO UPDATE SET alfa_puntos_por_min = EXCLUDED.alfa_puntos_por_min, actualizado_at = CURRENT_TIMESTAMP""")
                .param("local", localId).param("alfa", alfa).update();
    }

    @Override
    public void recalcularClaves(int localId, LocalDate fecha) {
        jdbc.sql("SELECT recalcular_claves(:local, CAST(:fecha AS date))").param("local", localId).param("fecha", fecha).query(Integer.class).list();
    }

    // --- Transferencias ---

    @Override
    public List<Transferible> transferibles(int localId, LocalDate fecha, Integer ventanillaId, int limite) {
        return jdbc.sql("""
                        SELECT t.id, t.codigo, t.cola_id, c.nombre AS cola, t.estado::text AS estado,
                               (t.estado = 'LLAMADO' AND t.ventanilla_id = CAST(:v AS int)) AS propia
                          FROM turno t JOIN cola c ON c.id = t.cola_id
                         WHERE t.local_id = :local AND t.fecha = :fecha
                           AND (t.estado IN ('EMITIDO','AVISADO') OR (t.estado = 'LLAMADO' AND t.ventanilla_id = CAST(:v AS int)))
                         ORDER BY (t.estado = 'LLAMADO') DESC, t.clave_orden DESC, t.emitido_at, t.id
                         LIMIT :limite
                        """)
                .param("local", localId).param("fecha", fecha).param("v", ventanillaId).param("limite", limite)
                .query((rs, i) -> new Transferible(rs.getInt("id"), rs.getString("codigo"), rs.getInt("cola_id"), rs.getString("cola"),
                        rs.getString("estado"), rs.getBoolean("propia")))
                .list();
    }

    @Override
    public void registrarTransferencia(NuevaTransferencia t) {
        jdbc.sql("""
                        INSERT INTO transferencia (local_id, turno_origen_id, turno_destino_id, de_cola_id, a_cola_id, a_ventanilla_id, motivo, detalle,
                                                   origen, regla_id, usuario_id)
                        VALUES (:local, :o, :d, :de, :a, CAST(:v AS int), :motivo, :detalle, CAST(:origen AS "OrigenTransferencia"), CAST(:regla AS int),
                                CAST(:usuario AS int))""")
                .param("local", t.localId()).param("o", t.turnoOrigenId()).param("d", t.turnoDestinoId()).param("de", t.deColaId())
                .param("a", t.aColaId()).param("v", t.aVentanillaId()).param("motivo", t.motivo()).param("detalle", t.detalle())
                .param("origen", t.origen()).param("regla", t.reglaId()).param("usuario", t.usuarioId())
                .update();
    }

    @Override
    public List<Transferencia> transferencias(int localId, Instant desde, Instant hasta, Integer cursor, int limite) {
        return jdbc.sql("""
                        SELECT x.id, x.turno_origen_id, x.turno_destino_id, o.codigo AS cod_o, d.codigo AS cod_d, cd.nombre AS de_cola, ca.nombre AS a_cola,
                               x.motivo, x.detalle, x.origen::text AS origen, x.regla_id, x.usuario_id, x.created_at
                          FROM transferencia x
                          JOIN turno o ON o.id = x.turno_origen_id JOIN turno d ON d.id = x.turno_destino_id
                          LEFT JOIN cola cd ON cd.id = x.de_cola_id LEFT JOIN cola ca ON ca.id = x.a_cola_id
                         WHERE x.local_id = :local AND (CAST(:desde AS timestamp) IS NULL OR x.created_at >= CAST(:desde AS timestamp))
                           AND (CAST(:hasta AS timestamp) IS NULL OR x.created_at <= CAST(:hasta AS timestamp))
                           AND (CAST(:cursor AS int) IS NULL OR x.id < :cursor)
                         ORDER BY x.id DESC LIMIT :limite
                        """)
                .param("local", localId).param("desde", utc(desde)).param("hasta", utc(hasta)).param("cursor", cursor).param("limite", limite)
                .query((rs, i) -> new Transferencia(rs.getInt("id"), rs.getInt("turno_origen_id"), rs.getInt("turno_destino_id"), rs.getString("cod_o"),
                        rs.getString("cod_d"), rs.getString("de_cola"), rs.getString("a_cola"), rs.getString("motivo"), rs.getString("detalle"),
                        rs.getString("origen"), Sql.entero(rs, "regla_id"), Sql.entero(rs, "usuario_id"), Sql.instante(rs, "created_at")))
                .list();
    }

    // --- Mapeos ---

    private static Object utc(Instant i) {
        return i == null ? null : Sql.utc(i);
    }

    private static Double doble(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    private static Regla regla(ResultSet rs, int i) throws SQLException {
        Estado e = rs.getObject("e_id") == null ? null
                : new Estado(rs.getString("fase"), Sql.instante(rs, "verdadera_desde"), Sql.instante(rs, "falsa_desde"),
                        Sql.instante(rs, "ultima_ejecucion_at"), rs.getString("estado_accion"));
        return new Regla(rs.getInt("id"), rs.getInt("local_id"), rs.getString("nombre"), rs.getBoolean("activa"), rs.getString("modo"),
                rs.getString("condicion"), rs.getString("accion"), rs.getInt("for_segundos"), rs.getInt("for_segundos_reversa"), rs.getInt("cooldown_seg"),
                rs.getInt("histeresis_pct"), Sql.entero(rs, "ttl_seg"), rs.getBoolean("requiere_confirmacion"), rs.getInt("prioridad"),
                Sql.instante(rs, "created_at"), e);
    }

    private static Ejecucion ejecucion(ResultSet rs, int i) throws SQLException {
        return new Ejecucion(rs.getLong("id"), rs.getInt("regla_id"), rs.getString("regla"), Sql.instante(rs, "ts"), rs.getString("fase"),
                rs.getString("resultado"), rs.getString("detalle"), Sql.entero(rs, "confirmada_por"));
    }

    private static VentanillaM6 ventanilla(ResultSet rs, int i) throws SQLException {
        return new VentanillaM6(rs.getInt("id"), rs.getString("nombre"), Sql.entero(rs, "cola_id"), rs.getBoolean("activa"),
                Sql.entero(rs, "cola_original_id"), Sql.entero(rs, "regla_asignadora_id"));
    }
}
