package pe.turnoya.analitica.infraestructura;

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
import pe.turnoya.analitica.dominio.RepositorioAnalitica;
import pe.turnoya.compartido.datos.Sql;

/** Consultas de analítica (percentiles con {@code percentile_cont}, mapa de calor, SLA, CSAT) y tablas del motor de alertas. */
@Repository
class AnaliticaJdbc implements RepositorioAnalitica {

    private static final String HORA_LOCAL = "EXTRACT(HOUR FROM ((t.emitido_at AT TIME ZONE 'UTC') AT TIME ZONE CAST(:zona AS text)))";

    private final JdbcClient jdbc;

    AnaliticaJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // --- Analítica ---

    @Override
    public List<FilaPercentil> percentiles(int localId, LocalDate desde, LocalDate hasta, Integer colaId, Agrupar agrupar, String zona) {
        String grupo = switch (agrupar) {
            case COLA -> "c.nombre";
            case HORA -> "lpad(" + HORA_LOCAL + "::int::text, 2, '0') || ':00'";
            case DIA -> "to_char(t.fecha, 'YYYY-MM-DD')";
        };
        return jdbc.sql("SELECT " + grupo + """
                         AS grupo, COUNT(*)::int AS n,
                               percentile_cont(0.5)  WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p50,
                               percentile_cont(0.9)  WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p90,
                               percentile_cont(0.95) WITHIN GROUP (ORDER BY LEAST(EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)), 28800)) / 60 AS p95,
                               percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
                                   FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a50,
                               percentile_cont(0.9)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
                                   FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a90,
                               percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.finalizado_at - t.llamado_at)))
                                   FILTER (WHERE t.estado = 'ATENDIDO' AND t.finalizado_at IS NOT NULL) / 60 AS a95
                          FROM turno t JOIN cola c ON c.id = t.cola_id
                         WHERE t.local_id = :local AND t.fecha BETWEEN :desde AND :hasta AND t.llamado_at IS NOT NULL AND t.llamado_at >= t.emitido_at
                           AND (CAST(:cola AS int) IS NULL OR t.cola_id = CAST(:cola AS int))
                         GROUP BY 1 ORDER BY 1
                        """)
                .param("local", localId).param("desde", desde).param("hasta", hasta).param("cola", colaId).param("zona", zona)
                .query((rs, i) -> new FilaPercentil(rs.getString("grupo"), rs.getInt("n"), doble(rs, "p50"), doble(rs, "p90"), doble(rs, "p95"),
                        doble(rs, "a50"), doble(rs, "a90"), doble(rs, "a95")))
                .list();
    }

    @Override
    public List<CeldaCalor> mapaDeCalor(int localId, LocalDate desde, LocalDate hasta, Integer colaId, String zona) {
        return jdbc.sql("SELECT EXTRACT(DOW FROM t.fecha)::int AS dow, " + HORA_LOCAL + """
                        ::int AS hora,
                               COUNT(*)::int AS llegadas,
                               COUNT(*) FILTER (WHERE t.estado IN ('CANCELADO', 'NO_SE_PRESENTO'))::int AS abandonos,
                               percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)))
                                   FILTER (WHERE t.llamado_at IS NOT NULL) / 60 AS p90,
                               COUNT(*) FILTER (WHERE t.llamado_at IS NOT NULL)::int AS n
                          FROM turno t
                         WHERE t.local_id = :local AND t.fecha BETWEEN :desde AND :hasta AND t.estado <> 'TRANSFERIDO'
                           AND (CAST(:cola AS int) IS NULL OR t.cola_id = CAST(:cola AS int))
                         GROUP BY 1, 2
                        """)
                .param("local", localId).param("desde", desde).param("hasta", hasta).param("cola", colaId).param("zona", zona)
                .query((rs, i) -> new CeldaCalor(rs.getInt("dow"), rs.getInt("hora"), rs.getInt("llegadas"), rs.getInt("abandonos"), doble(rs, "p90"),
                        rs.getInt("n")))
                .list();
    }

    private static final String COLA_SLA = """
            SELECT c.id, c.nombre, s.espera_max_min, s.objetivo_pct, s.ventana_min, COALESCE(s.activo, false) AS activo
              FROM cola c LEFT JOIN sla_cola s ON s.cola_id = c.id
            """;

    @Override
    public List<ColaSla> colasConSla(int localId) {
        return jdbc.sql(COLA_SLA + " WHERE c.local_id = :local AND c.activa ORDER BY c.orden, c.id").param("local", localId)
                .query(AnaliticaJdbc::colaSla).list();
    }

    @Override
    public Optional<ColaSla> colaConSla(int colaId, int localId) {
        return jdbc.sql(COLA_SLA + " WHERE c.id = :id AND c.local_id = :local").param("id", colaId).param("local", localId)
                .query(AnaliticaJdbc::colaSla).optional();
    }

    @Override
    public void guardarSla(int colaId, int esperaMaxMin, double objetivoPct, int ventanaMin, boolean activo) {
        jdbc.sql("""
                        INSERT INTO sla_cola (cola_id, espera_max_min, objetivo_pct, ventana_min, activo) VALUES (:cola, :max, :obj, :ventana, :activo)
                        ON CONFLICT (cola_id) DO UPDATE SET espera_max_min = EXCLUDED.espera_max_min, objetivo_pct = EXCLUDED.objetivo_pct,
                               ventana_min = EXCLUDED.ventana_min, activo = EXCLUDED.activo""")
                .param("cola", colaId).param("max", esperaMaxMin).param("obj", objetivoPct).param("ventana", ventanaMin).param("activo", activo).update();
    }

    @Override
    public List<TiemposTurno> turnosDesde(int colaId, Instant desde) {
        return jdbc.sql("""
                        SELECT estado::text AS estado, emitido_at, llamado_at, finalizado_at FROM turno
                         WHERE cola_id = :cola AND emitido_at >= :desde AND estado <> 'TRANSFERIDO'
                        """)
                .param("cola", colaId).param("desde", Sql.utc(desde))
                .query((rs, i) -> new TiemposTurno(rs.getString("estado"), Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at"),
                        Sql.instante(rs, "finalizado_at")))
                .list();
    }

    @Override
    public List<PuntoSerie> serieSla(int colaId, int maxSeg, Instant desde) {
        return jdbc.sql("""
                        SELECT date_trunc('hour', t.emitido_at) AS hora,
                               COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)) <= :max)::int AS cumplen, COUNT(*)::int AS total
                          FROM turno t
                         WHERE t.cola_id = :cola AND t.llamado_at IS NOT NULL AND t.emitido_at >= :desde
                         GROUP BY 1 ORDER BY 1
                        """)
                .param("max", maxSeg).param("cola", colaId).param("desde", Sql.utc(desde))
                .query((rs, i) -> new PuntoSerie(Sql.instante(rs, "hora"), rs.getInt("cumplen"), rs.getInt("total")))
                .list();
    }

    @Override
    public List<FilaValoracion> valoraciones(int localId, LocalDate desde, LocalDate hasta) {
        return jdbc.sql("""
                        SELECT v.estrellas, v.comentario, v.created_at, t.emitido_at, t.llamado_at
                          FROM valoracion v JOIN turno t ON t.id = v.turno_id
                         WHERE t.local_id = :local AND t.fecha BETWEEN :desde AND :hasta
                         ORDER BY v.created_at DESC
                        """)
                .param("local", localId).param("desde", desde).param("hasta", hasta)
                .query((rs, i) -> new FilaValoracion(rs.getInt("estrellas"), rs.getString("comentario"), Sql.instante(rs, "created_at"),
                        Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at")))
                .list();
    }

    @Override
    public Map<String, Integer> conteoPorEstado(int localId, LocalDate desde, LocalDate hasta, Integer colaId) {
        Map<String, Integer> m = new LinkedHashMap<>();
        jdbc.sql("""
                        SELECT estado::text AS estado, COUNT(*)::int AS n FROM turno
                         WHERE local_id = :local AND fecha BETWEEN :desde AND :hasta AND estado <> 'TRANSFERIDO'
                           AND (CAST(:cola AS int) IS NULL OR cola_id = CAST(:cola AS int))
                         GROUP BY 1 ORDER BY 1
                        """)
                .param("local", localId).param("desde", desde).param("hasta", hasta).param("cola", colaId)
                .query((rs, i) -> m.put(rs.getString("estado"), rs.getInt("n"))).list();
        return m;
    }

    @Override
    public void refrescarVista() {
        jdbc.sql("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_turno_franja").update();
    }

    // --- Mediciones ---

    @Override
    public List<ColaBreve> colasActivas(int localId, Integer colaId) {
        return jdbc.sql("""
                        SELECT id, nombre FROM cola WHERE local_id = :local AND activa AND (CAST(:cola AS int) IS NULL OR id = CAST(:cola AS int))
                         ORDER BY orden, id
                        """)
                .param("local", localId).param("cola", colaId).query((rs, i) -> new ColaBreve(rs.getInt("id"), rs.getString("nombre"))).list();
    }

    @Override
    public Optional<Instant> masAntiguoEnEspera(int colaId, LocalDate fecha) {
        return jdbc.sql("SELECT MIN(emitido_at) AS m FROM turno WHERE cola_id = :cola AND fecha = :fecha AND estado IN ('EMITIDO','AVISADO')")
                .param("cola", colaId).param("fecha", fecha).query((rs, i) -> Sql.instante(rs, "m")).optional().filter(x -> x != null);
    }

    @Override
    public int enEspera(int colaId, LocalDate fecha) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE cola_id = :cola AND fecha = :fecha AND estado IN ('EMITIDO','AVISADO')")
                .param("cola", colaId).param("fecha", fecha).query(Integer.class).single();
    }

    @Override
    public int enEsperaDelLocal(int localId, LocalDate fecha, Integer colaId) {
        return jdbc.sql("""
                        SELECT COUNT(*) FROM turno WHERE local_id = :local AND fecha = :fecha AND estado IN ('EMITIDO','AVISADO')
                           AND (CAST(:cola AS int) IS NULL OR cola_id = CAST(:cola AS int))
                        """)
                .param("local", localId).param("fecha", fecha).param("cola", colaId).query(Integer.class).single();
    }

    @Override
    public List<Integer> llegadasHistoricas(int colaId, int dow, int franja, LocalDate desde, LocalDate hasta) {
        return jdbc.sql("""
                        SELECT llegadas FROM mv_turno_franja
                         WHERE cola_id = :cola AND dow = :dow AND franja = :franja AND fecha >= :desde AND fecha < :hasta
                        """)
                .param("cola", colaId).param("dow", dow).param("franja", franja).param("desde", desde).param("hasta", hasta)
                .query(Integer.class).list();
    }

    @Override
    public int llegadasDesde(int colaId, Instant desde) {
        return jdbc.sql("SELECT COUNT(*) FROM turno WHERE cola_id = :cola AND emitido_at >= :desde").param("cola", colaId)
                .param("desde", Sql.utc(desde)).query(Integer.class).single();
    }

    @Override
    public List<VentanillaBreve> ventanillasActivas(int localId) {
        return jdbc.sql("SELECT id, nombre, cola_id FROM ventanilla WHERE local_id = :local AND activa ORDER BY id").param("local", localId)
                .query((rs, i) -> new VentanillaBreve(rs.getInt("id"), rs.getString("nombre"), Sql.entero(rs, "cola_id"))).list();
    }

    @Override
    public Optional<UltimoUso> ultimoUso(int ventanillaId, LocalDate fecha) {
        return jdbc.sql("""
                        SELECT llamado_at, estado::text AS estado FROM turno WHERE ventanilla_id = :v AND fecha = :fecha
                         ORDER BY llamado_at DESC NULLS LAST LIMIT 1
                        """)
                .param("v", ventanillaId).param("fecha", fecha)
                .query((rs, i) -> new UltimoUso(Sql.instante(rs, "llamado_at"), rs.getString("estado"))).optional();
    }

    @Override
    public List<String> ultimosEstadosWhatsapp(int localId, int n) {
        return jdbc.sql("SELECT estado::text FROM notificacion WHERE local_id = :local AND tipo = 'WHATSAPP' ORDER BY id DESC LIMIT :n")
                .param("local", localId).param("n", n).query(String.class).list();
    }

    @Override
    public List<KioscoBreve> kioscosEmparejados(int localId) {
        return jdbc.sql("""
                        SELECT id, numero, nombre, ultimo_heartbeat_at FROM dispositivo_kiosco
                         WHERE local_id = :local AND activo AND token_hash IS NOT NULL ORDER BY numero
                        """)
                .param("local", localId)
                .query((rs, i) -> new KioscoBreve(rs.getInt("id"), rs.getInt("numero"), rs.getString("nombre"), Sql.instante(rs, "ultimo_heartbeat_at")))
                .list();
    }

    // --- Reglas de alerta ---

    private static final String REGLA = """
            SELECT id, local_id, tipo::text AS tipo, nombre, umbral::text AS umbral, niveles::text AS niveles, resolver_tras_min, silenciada_hasta, activa
              FROM regla_alerta
            """;

    @Override
    public int contarReglas(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM regla_alerta WHERE local_id = ?").param(localId).query(Integer.class).single();
    }

    @Override
    public void crearRegla(int localId, String tipo, String nombre, String umbralJson, String nivelesJson, int resolverTrasMin) {
        jdbc.sql("""
                        INSERT INTO regla_alerta (local_id, tipo, nombre, umbral, niveles, resolver_tras_min)
                        VALUES (:local, CAST(:tipo AS "TipoAlerta"), :nombre, CAST(:umbral AS jsonb), CAST(:niveles AS jsonb), :resolver)""")
                .param("local", localId).param("tipo", tipo).param("nombre", nombre).param("umbral", umbralJson).param("niveles", nivelesJson)
                .param("resolver", resolverTrasMin).update();
    }

    @Override
    public List<ReglaAlerta> reglas(int localId) {
        return jdbc.sql(REGLA + " WHERE local_id = :local ORDER BY id").param("local", localId).query(AnaliticaJdbc::regla).list();
    }

    @Override
    public Optional<ReglaAlerta> regla(int id, int localId) {
        return jdbc.sql(REGLA + " WHERE id = :id AND local_id = :local").param("id", id).param("local", localId).query(AnaliticaJdbc::regla).optional();
    }

    @Override
    public void actualizarRegla(int id, String nombre, String umbralJson, String nivelesJson, int resolverTrasMin, boolean activa, Instant silenciadaHasta) {
        jdbc.sql("""
                        UPDATE regla_alerta SET nombre = :nombre, umbral = CAST(:umbral AS jsonb), niveles = CAST(:niveles AS jsonb),
                               resolver_tras_min = :resolver, activa = :activa, silenciada_hasta = CAST(:silencio AS timestamp)
                         WHERE id = :id""")
                .param("nombre", nombre).param("umbral", umbralJson).param("niveles", nivelesJson).param("resolver", resolverTrasMin)
                .param("activa", activa).param("silencio", silenciadaHasta == null ? null : Sql.utc(silenciadaHasta)).param("id", id).update();
    }

    @Override
    public boolean eliminarRegla(int id, int localId) {
        return jdbc.sql("DELETE FROM regla_alerta WHERE id = :id AND local_id = :local").param("id", id).param("local", localId).update() > 0;
    }

    // --- Alertas ---

    private static final String ALERTA = """
            SELECT id, local_id, regla_id, tipo::text AS tipo, huella, entidad, nivel, estado::text AS estado, titulo, detalle::text AS detalle, ocurrencias,
                   primera_vez_at, ultima_vez_at, proximo_escala_at, reconocida_por, reconocida_at, resuelta_at, silenciada_hasta
              FROM alerta
            """;

    @Override
    public Optional<Racha> racha(String huella) {
        return jdbc.sql("SELECT disparos, normal_desde FROM alerta_racha WHERE huella = ?").param(huella)
                .query((rs, i) -> new Racha(rs.getInt("disparos"), Sql.instante(rs, "normal_desde"))).optional();
    }

    @Override
    public void guardarRacha(String huella, int localId, int disparos, Instant normalDesde, Instant ahora) {
        jdbc.sql("""
                        INSERT INTO alerta_racha (huella, local_id, disparos, normal_desde, actualizada_at)
                        VALUES (:huella, :local, :disparos, CAST(:normal AS timestamp), :ahora)
                        ON CONFLICT (huella) DO UPDATE SET disparos = EXCLUDED.disparos, normal_desde = EXCLUDED.normal_desde,
                               actualizada_at = EXCLUDED.actualizada_at""")
                .param("huella", huella).param("local", localId).param("disparos", disparos)
                .param("normal", normalDesde == null ? null : Sql.utc(normalDesde)).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public Optional<Alerta> alertaViva(String huella) {
        return jdbc.sql(ALERTA + " WHERE huella = :h AND estado IN ('ABIERTA','RECONOCIDA','SILENCIADA') LIMIT 1").param("h", huella)
                .query(AnaliticaJdbc::alerta).optional();
    }

    @Override
    public Optional<Alerta> ultimaResuelta(String huella) {
        return jdbc.sql(ALERTA + " WHERE huella = :h AND estado = 'RESUELTA' ORDER BY resuelta_at DESC NULLS LAST LIMIT 1").param("h", huella)
                .query(AnaliticaJdbc::alerta).optional();
    }

    @Override
    public Optional<Long> abrir(int localId, Integer reglaId, String tipo, String huella, String entidad, String titulo, String detalleJson, Instant ahora,
                                Instant proximoEscala) {
        // ON CONFLICT: otra instancia ya abrió la alerta viva (índice único parcial); no aborta la transacción
        return jdbc.sql("""
                        INSERT INTO alerta (local_id, regla_id, tipo, huella, entidad, nivel, titulo, detalle, primera_vez_at, ultima_vez_at, proximo_escala_at)
                        VALUES (:local, CAST(:regla AS int), CAST(:tipo AS "TipoAlerta"), :huella, :entidad, 1, :titulo, CAST(:detalle AS jsonb), :ahora, :ahora,
                                CAST(:escala AS timestamp))
                        ON CONFLICT DO NOTHING
                        RETURNING id""")
                .param("local", localId).param("regla", reglaId).param("tipo", tipo).param("huella", huella).param("entidad", entidad)
                .param("titulo", titulo).param("detalle", detalleJson).param("ahora", Sql.utc(ahora)).param("escala", utc(proximoEscala))
                .query(Long.class).optional();
    }

    @Override
    public void reabrir(long id, Instant ahora, String detalleJson, Instant proximoEscala) {
        jdbc.sql("""
                        UPDATE alerta SET estado = 'ABIERTA', resuelta_at = NULL, ultima_vez_at = :ahora, ocurrencias = ocurrencias + 1,
                               detalle = CAST(:detalle AS jsonb), proximo_escala_at = CAST(:escala AS timestamp) WHERE id = :id""")
                .param("ahora", Sql.utc(ahora)).param("detalle", detalleJson).param("escala", utc(proximoEscala)).param("id", id).update();
    }

    @Override
    public void repetir(long id, Instant ahora, String detalleJson) {
        jdbc.sql("UPDATE alerta SET ultima_vez_at = :ahora, ocurrencias = ocurrencias + 1, detalle = CAST(:detalle AS jsonb) WHERE id = :id")
                .param("ahora", Sql.utc(ahora)).param("detalle", detalleJson).param("id", id).update();
    }

    @Override
    public void escalar(long id, int nivel, Instant proximoEscala, Instant ahora) {
        jdbc.sql("UPDATE alerta SET nivel = :nivel, proximo_escala_at = CAST(:escala AS timestamp), ultima_vez_at = :ahora WHERE id = :id")
                .param("nivel", nivel).param("escala", utc(proximoEscala)).param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public void desilenciar(long id, Instant ahora) {
        jdbc.sql("UPDATE alerta SET estado = 'ABIERTA', silenciada_hasta = NULL, ultima_vez_at = :ahora WHERE id = :id")
                .param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public void resolver(long id, Instant ahora) {
        jdbc.sql("UPDATE alerta SET estado = 'RESUELTA', resuelta_at = :ahora WHERE id = :id").param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public void reconocer(long id, Integer usuarioId, Instant ahora) {
        jdbc.sql("""
                        UPDATE alerta SET estado = 'RECONOCIDA', reconocida_por = CAST(:u AS int), reconocida_at = :ahora, proximo_escala_at = NULL
                         WHERE id = :id""")
                .param("u", usuarioId).param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public void silenciar(long id, Instant hasta) {
        jdbc.sql("UPDATE alerta SET estado = 'SILENCIADA', silenciada_hasta = :hasta, proximo_escala_at = NULL WHERE id = :id")
                .param("hasta", Sql.utc(hasta)).param("id", id).update();
    }

    @Override
    public void reabrirManual(long id, Instant ahora) {
        jdbc.sql("UPDATE alerta SET estado = 'ABIERTA', resuelta_at = NULL, ultima_vez_at = :ahora WHERE id = :id")
                .param("ahora", Sql.utc(ahora)).param("id", id).update();
    }

    @Override
    public Optional<Alerta> alerta(long id, int localId) {
        return jdbc.sql(ALERTA + " WHERE id = :id AND local_id = :local").param("id", id).param("local", localId).query(AnaliticaJdbc::alerta).optional();
    }

    @Override
    public List<Alerta> alertas(int localId, List<String> estados, String tipo, Long cursor, int limite) {
        String filtroEstados = estados == null || estados.isEmpty() ? "" : " AND estado::text IN (:estados)";
        var sql = jdbc.sql(ALERTA + " WHERE local_id = :local" + filtroEstados + """
                         AND (CAST(:tipo AS text) IS NULL OR tipo::text = CAST(:tipo AS text))
                         AND (CAST(:cursor AS bigint) IS NULL OR id < CAST(:cursor AS bigint))
                        ORDER BY id DESC LIMIT :limite
                        """)
                .param("local", localId).param("tipo", tipo).param("cursor", cursor).param("limite", limite);
        if (!filtroEstados.isEmpty()) {
            sql = sql.param("estados", estados);
        }
        return sql.query(AnaliticaJdbc::alerta).list();
    }

    @Override
    public int contarAbiertas(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM alerta WHERE local_id = ? AND estado = 'ABIERTA'").param(localId).query(Integer.class).single();
    }

    @Override
    public List<Alerta> deSistemaSinRepetir(int localId, Instant limite) {
        return jdbc.sql(ALERTA + """
                         WHERE local_id = :local AND estado IN ('ABIERTA','RECONOCIDA')
                           AND tipo IN ('PREDICCION_DERIVA','BALANCEO_LIMITE','JOB_FALLIDO') AND ultima_vez_at < :limite
                        """)
                .param("local", localId).param("limite", Sql.utc(limite)).query(AnaliticaJdbc::alerta).list();
    }

    @Override
    public boolean registrarNotificacion(long alertaId, int nivel, String canal, Instant hora) {
        return jdbc.sql("""
                        INSERT INTO alerta_notificacion (alerta_id, nivel, canal, estado, hora) VALUES (:a, :n, :c, 'PENDIENTE', :h)
                        ON CONFLICT DO NOTHING""")
                .param("a", alertaId).param("n", nivel).param("c", canal).param("h", Sql.utc(hora)).update() > 0;
    }

    @Override
    public void actualizarNotificacion(long alertaId, int nivel, String canal, Instant hora, String estado, String destino) {
        jdbc.sql("UPDATE alerta_notificacion SET estado = :e, destino = :d WHERE alerta_id = :a AND nivel = :n AND canal = :c AND hora = :h")
                .param("e", estado).param("d", destino).param("a", alertaId).param("n", nivel).param("c", canal).param("h", Sql.utc(hora)).update();
    }

    @Override
    public List<Integer> localesActivos() {
        return jdbc.sql("SELECT id FROM local WHERE activo ORDER BY id").query(Integer.class).list();
    }

    @Override
    public boolean candado(int localId) {
        return Boolean.TRUE.equals(jdbc.sql("SELECT pg_try_advisory_xact_lock(hashtext(:clave))").param("clave", "alertas:" + localId)
                .query(Boolean.class).single());
    }

    @Override
    public int borrarResueltasAntes(Instant limite) {
        return jdbc.sql("DELETE FROM alerta WHERE estado = 'RESUELTA' AND resuelta_at < :limite").param("limite", Sql.utc(limite)).update();
    }

    // --- Mapeos ---

    private static Object utc(Instant i) {
        return i == null ? null : Sql.utc(i);
    }

    private static Double doble(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    private static ColaSla colaSla(ResultSet rs, int i) throws SQLException {
        return new ColaSla(rs.getInt("id"), rs.getString("nombre"), Sql.entero(rs, "espera_max_min"), doble(rs, "objetivo_pct"),
                Sql.entero(rs, "ventana_min"), rs.getBoolean("activo"));
    }

    private static ReglaAlerta regla(ResultSet rs, int i) throws SQLException {
        return new ReglaAlerta(rs.getInt("id"), rs.getInt("local_id"), rs.getString("tipo"), rs.getString("nombre"), rs.getString("umbral"),
                rs.getString("niveles"), rs.getInt("resolver_tras_min"), Sql.instante(rs, "silenciada_hasta"), rs.getBoolean("activa"));
    }

    private static Alerta alerta(ResultSet rs, int i) throws SQLException {
        return new Alerta(rs.getLong("id"), rs.getInt("local_id"), Sql.entero(rs, "regla_id"), rs.getString("tipo"), rs.getString("huella"),
                rs.getString("entidad"), rs.getInt("nivel"), rs.getString("estado"), rs.getString("titulo"), rs.getString("detalle"), rs.getInt("ocurrencias"),
                Sql.instante(rs, "primera_vez_at"), Sql.instante(rs, "ultima_vez_at"), Sql.instante(rs, "proximo_escala_at"), Sql.entero(rs, "reconocida_por"),
                Sql.instante(rs, "reconocida_at"), Sql.instante(rs, "resuelta_at"), Sql.instante(rs, "silenciada_hasta"));
    }
}
