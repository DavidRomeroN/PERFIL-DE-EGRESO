package pe.turnoya.prediccion.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.prediccion.dominio.ModelosEspera.Estado;
import pe.turnoya.prediccion.dominio.ModelosEspera.Importancia;
import pe.turnoya.prediccion.dominio.ModelosEspera.Tipo;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

/** Acceso a {@code config_prediccion}, {@code modelo_entrenado}, {@code prediccion_log} y a los tiempos de {@code turno}. */
@Repository
class PrediccionJdbc implements RepositorioPrediccion {

    private static final String COLUMNAS_MODELO = """
            id, local_id, cola_id, tipo::text AS tipo, version, n_muestras, mae, medae, acierto_5, sesgo, cobertura, ancho_medio,
            importancia::text AS importancia, activo, deriva, entrenado_at""";

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    PrediccionJdbc(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json.rebuild().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    }

    @Override
    public Config config(int localId) {
        // Solo lectura (se llama dentro de transacciones readOnly): sin fila, los mismos valores por defecto de la tabla.
        return jdbc.sql("SELECT modelo, alfa_ema, nivel_confianza, dias_entrenamiento FROM config_prediccion WHERE local_id = :local")
                .param("local", localId)
                .query((rs, n) -> new Config(rs.getString("modelo"), rs.getDouble("alfa_ema"), rs.getDouble("nivel_confianza"),
                        rs.getInt("dias_entrenamiento")))
                .optional()
                .orElse(new Config("AUTO", 0.2, 0.8, 60));
    }

    @Override
    public void guardarConfig(int localId, Config c) {
        jdbc.sql("""
                        INSERT INTO config_prediccion (local_id, modelo, alfa_ema, nivel_confianza, dias_entrenamiento)
                        VALUES (:local, :modelo, :alfa, :nivel, :dias)
                        ON CONFLICT (local_id) DO UPDATE SET modelo = EXCLUDED.modelo, alfa_ema = EXCLUDED.alfa_ema,
                          nivel_confianza = EXCLUDED.nivel_confianza, dias_entrenamiento = EXCLUDED.dias_entrenamiento""")
                .param("local", localId).param("modelo", c.modelo()).param("alfa", c.alfaEma()).param("nivel", c.nivelConfianza())
                .param("dias", c.diasEntrenamiento())
                .update();
    }

    @Override
    public Optional<ColaInfo> cola(int colaId) {
        return jdbc.sql("SELECT id, local_id, tiempo_atencion_base, activa FROM cola WHERE id = :id").param("id", colaId)
                .query((rs, n) -> new ColaInfo(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("tiempo_atencion_base"), rs.getBoolean("activa")))
                .optional();
    }

    @Override
    public List<Integer> colasActivas(int localId, Integer soloColaId) {
        return jdbc.sql("""
                        SELECT id FROM cola WHERE local_id = :local AND activa AND (CAST(:cola AS int) IS NULL OR id = :cola)
                        ORDER BY orden, id""")
                .param("local", localId).param("cola", soloColaId)
                .query(Integer.class).list();
    }

    @Override
    public List<EsperaCola> esperasPorCola(int localId, java.time.LocalDate hoy, java.time.LocalDate desde) {
        return jdbc.sql("""
                        WITH esperas AS (
                          SELECT t.cola_id, t.fecha, EXTRACT(EPOCH FROM (t.llamado_at - t.emitido_at)) / 60.0 AS min
                            FROM turno t JOIN cola c ON c.id = t.cola_id
                           WHERE c.local_id = :local AND t.llamado_at IS NOT NULL AND t.fecha BETWEEN :desde AND :hoy
                        )
                        SELECT c.id, c.nombre,
                               (SELECT count(*) FROM turno t WHERE t.cola_id = c.id AND t.fecha = :hoy AND t.estado IN ('EMITIDO', 'AVISADO')) AS esperando,
                               count(e.min) FILTER (WHERE e.fecha = :hoy) AS n_hoy,
                               avg(e.min) FILTER (WHERE e.fecha = :hoy) AS prom_hoy,
                               count(e.min) AS n_periodo,
                               avg(e.min) AS prom_periodo,
                               percentile_cont(0.9) WITHIN GROUP (ORDER BY e.min) AS p90
                          FROM cola c LEFT JOIN esperas e ON e.cola_id = c.id
                         WHERE c.local_id = :local AND c.activa
                         GROUP BY c.id, c.nombre, c.orden
                         ORDER BY c.orden, c.id""")
                .param("local", localId).param("hoy", hoy).param("desde", desde)
                .query((rs, n) -> new EsperaCola(rs.getInt("id"), rs.getString("nombre"), rs.getInt("esperando"), rs.getInt("n_hoy"),
                        doble(rs, "prom_hoy"), rs.getInt("n_periodo"), doble(rs, "prom_periodo"), doble(rs, "p90")))
                .list();
    }

    @Override
    public List<ColaNombre> colasConNombre(int localId) {
        return jdbc.sql("SELECT id, nombre FROM cola WHERE local_id = :local AND activa ORDER BY orden, id").param("local", localId)
                .query((rs, n) -> new ColaNombre(rs.getInt("id"), rs.getString("nombre"))).list();
    }

    @Override
    public List<Double> ultimosServicios(int colaId, int n) {
        List<Double> xs = new java.util.ArrayList<>(jdbc.sql("""
                        SELECT EXTRACT(EPOCH FROM (finalizado_at - llamado_at))::float8 FROM turno
                         WHERE cola_id = :cola AND estado = 'ATENDIDO' AND llamado_at IS NOT NULL AND finalizado_at IS NOT NULL
                         ORDER BY finalizado_at DESC LIMIT :n""")
                .param("cola", colaId).param("n", n)
                .query(Double.class).list());
        java.util.Collections.reverse(xs);
        return xs;
    }

    @Override
    public int ventanillasConActividad(int colaId, Instant desde) {
        return jdbc.sql("""
                        SELECT COUNT(DISTINCT ventanilla_id) FROM turno
                         WHERE cola_id = :cola AND ventanilla_id IS NOT NULL AND (estado = 'LLAMADO' OR llamado_at >= :desde)""")
                .param("cola", colaId).param("desde", Sql.utc(desde))
                .query(Integer.class).single();
    }

    @Override
    public int ventanillasActivasAsignadas(int colaId) {
        return jdbc.sql("SELECT COUNT(*) FROM ventanilla v JOIN cola c ON c.id = :cola WHERE v.local_id = c.local_id AND v.activa AND v.cola_id = :cola")
                .param("cola", colaId).query(Integer.class).single();
    }

    @Override
    public Optional<ModeloGuardado> modeloActivo(int colaId) {
        return jdbc.sql("SELECT id, version, parametros::text AS parametros FROM modelo_entrenado WHERE cola_id = :cola AND activo ORDER BY id DESC LIMIT 1")
                .param("cola", colaId)
                .query((rs, n) -> new ModeloGuardado(rs.getInt("id"), rs.getInt("version"), json.readValue(rs.getString("parametros"), Estado.class)))
                .optional();
    }

    @Override
    public void actualizarParametros(int modeloId, Estado estado) {
        jdbc.sql("UPDATE modelo_entrenado SET parametros = CAST(:p AS jsonb) WHERE id = :id")
                .param("p", json.writeValueAsString(estado)).param("id", modeloId).update();
    }

    @Override
    public Optional<TurnoDatos> turno(int turnoId) {
        return jdbc.sql("SELECT id, local_id, cola_id, emitido_at, llamado_at, finalizado_at, delante_emision FROM turno WHERE id = :id")
                .param("id", turnoId)
                .query((rs, n) -> new TurnoDatos(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("cola_id"), Sql.instante(rs, "emitido_at"),
                        Sql.instante(rs, "llamado_at"), Sql.instante(rs, "finalizado_at"), Sql.entero(rs, "delante_emision")))
                .optional();
    }

    @Override
    public void registrarPrediccion(int turnoId, int colaId, Tipo tipo, int version, int delante, int c, int predSeg, int loSeg, int hiSeg) {
        jdbc.sql("""
                        INSERT INTO prediccion_log (turno_id, cola_id, tipo, version, delante, c, pred_seg, lo_seg, hi_seg)
                        VALUES (:turno, :cola, CAST(:tipo AS "ModeloPrediccion"), :version, :delante, :c, :pred, :lo, :hi)
                        ON CONFLICT (turno_id) DO NOTHING""")
                .param("turno", turnoId).param("cola", colaId).param("tipo", tipo.name()).param("version", version).param("delante", delante)
                .param("c", c).param("pred", predSeg).param("lo", loSeg).param("hi", hiSeg)
                .update();
    }

    @Override
    public Optional<LogPrediccion> log(int turnoId) {
        return jdbc.sql("SELECT created_at, tipo::text AS tipo, delante, c, pred_seg, lo_seg, hi_seg, real_seg FROM prediccion_log WHERE turno_id = :t")
                .param("t", turnoId).query(PrediccionJdbc::log).optional();
    }

    @Override
    public void completarReal(int turnoId, int realSeg) {
        jdbc.sql("UPDATE prediccion_log SET real_seg = :real WHERE turno_id = :t AND real_seg IS NULL").param("real", realSeg).param("t", turnoId).update();
    }

    @Override
    public List<Muestra> muestras(int colaId, LocalDate desde) {
        return jdbc.sql("""
                        SELECT id, emitido_at, llamado_at, finalizado_at, estado::text = 'ATENDIDO' AS atendido, delante_emision,
                               ventanillas_activas_emision
                          FROM turno WHERE cola_id = :cola AND fecha >= CAST(:desde AS date) AND estado <> 'TRANSFERIDO'
                         ORDER BY emitido_at""")
                .param("cola", colaId).param("desde", desde)
                .query((rs, n) -> new Muestra(rs.getInt("id"), Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at"),
                        Sql.instante(rs, "finalizado_at"), rs.getBoolean("atendido"), Sql.entero(rs, "delante_emision"),
                        Sql.entero(rs, "ventanillas_activas_emision")))
                .list();
    }

    @Override
    public int ultimaVersion(int colaId) {
        return jdbc.sql("SELECT COALESCE(MAX(version), 0) FROM modelo_entrenado WHERE cola_id = :cola").param("cola", colaId).query(Integer.class).single();
    }

    @Override
    @Transactional
    public void guardarEntrenamiento(int localId, int colaId, int version, List<NuevoModelo> modelos, Tipo elegido) {
        jdbc.sql("UPDATE modelo_entrenado SET activo = false WHERE cola_id = :cola AND activo").param("cola", colaId).update();
        for (NuevoModelo m : modelos) {
            var met = m.metricas();
            boolean hay = met.n() > 0;
            jdbc.sql("""
                            INSERT INTO modelo_entrenado (local_id, cola_id, tipo, version, parametros, n_muestras, mae, medae, acierto_5, sesgo,
                                                          cobertura, ancho_medio, importancia, activo)
                            VALUES (:local, :cola, CAST(:tipo AS "ModeloPrediccion"), :version, CAST(:p AS jsonb), :n, :mae, :medae, :acierto, :sesgo,
                                    :cobertura, :ancho, CAST(:imp AS jsonb), :activo)""")
                    .param("local", localId).param("cola", colaId).param("tipo", m.tipo().name()).param("version", version)
                    .param("p", json.writeValueAsString(m.parametros())).param("n", met.n())
                    .param("mae", hay ? met.mae() : null).param("medae", hay ? met.medae() : null).param("acierto", hay ? met.acierto5() : null)
                    .param("sesgo", hay ? met.sesgo() : null).param("cobertura", hay ? met.cobertura() : null)
                    .param("ancho", hay ? met.anchoMedio() : null)
                    .param("imp", m.importancia() == null ? null : json.writeValueAsString(m.importancia()))
                    .param("activo", m.tipo() == elegido)
                    .update();
        }
    }

    @Override
    public List<ModeloFila> modelosDeVersion(int colaId, int version) {
        return jdbc.sql("SELECT " + COLUMNAS_MODELO + " FROM modelo_entrenado WHERE cola_id = :cola AND version = :v ORDER BY tipo")
                .param("cola", colaId).param("v", version).query(this::modelo).list();
    }

    @Override
    public Optional<ModeloFila> activo(int colaId) {
        return jdbc.sql("SELECT " + COLUMNAS_MODELO + " FROM modelo_entrenado WHERE cola_id = :cola AND activo ORDER BY id DESC LIMIT 1")
                .param("cola", colaId).query(this::modelo).optional();
    }

    @Override
    public List<LogPrediccion> serie(int colaId, Instant desde, int limite) {
        return jdbc.sql("""
                        SELECT created_at, tipo::text AS tipo, delante, c, pred_seg, lo_seg, hi_seg, real_seg FROM prediccion_log
                         WHERE cola_id = :cola AND real_seg IS NOT NULL AND created_at >= :desde ORDER BY created_at LIMIT :limite""")
                .param("cola", colaId).param("desde", Sql.utc(desde)).param("limite", limite)
                .query(PrediccionJdbc::log).list();
    }

    @Override
    public List<ModeloFila> activosVigilables() {
        return jdbc.sql("SELECT " + COLUMNAS_MODELO + " FROM modelo_entrenado WHERE activo AND tipo <> 'BASELINE' AND NOT deriva")
                .query(this::modelo).list();
    }

    @Override
    @Transactional
    public void volverABase(ModeloFila m) {
        jdbc.sql("UPDATE modelo_entrenado SET activo = false WHERE cola_id = :cola AND activo").param("cola", m.colaId()).update();
        jdbc.sql("UPDATE modelo_entrenado SET activo = true WHERE cola_id = :cola AND version = :v AND tipo = 'BASELINE'")
                .param("cola", m.colaId()).param("v", m.version()).update();
        jdbc.sql("UPDATE modelo_entrenado SET deriva = true WHERE id = :id").param("id", m.id()).update();
    }

    @Override
    public List<AvisoPendiente> avisosPendientes(int limite) {
        return jdbc.sql("""
                        SELECT id, local_id, cola_id, aviso_min_antes FROM turno
                         WHERE aviso_min_antes IS NOT NULL AND aviso_min_enviado_at IS NULL AND estado IN ('EMITIDO', 'AVISADO')
                         ORDER BY id LIMIT :limite""")
                .param("limite", limite)
                .query((rs, n) -> new AvisoPendiente(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("cola_id"), rs.getInt("aviso_min_antes")))
                .list();
    }

    @Override
    public int posicion(int turnoId) {
        return jdbc.sql("SELECT posicion_turno(:t)").param("t", turnoId).query(Integer.class).optional().orElse(1);
    }

    @Override
    public boolean marcarAvisoEnviado(int turnoId, Instant ahora) {
        return jdbc.sql("UPDATE turno SET aviso_min_enviado_at = :ahora WHERE id = :t AND aviso_min_enviado_at IS NULL")
                .param("ahora", Sql.utc(ahora)).param("t", turnoId).update() > 0;
    }

    @Override
    public Optional<TurnoToken> turnoPorToken(String token) {
        return jdbc.sql("SELECT id, local_id, estado::text AS estado FROM turno WHERE token = :token").param("token", token)
                .query((rs, n) -> new TurnoToken(rs.getInt("id"), rs.getInt("local_id"), rs.getString("estado"))).optional();
    }

    @Override
    public void configurarAviso(int turnoId, Integer minAntes) {
        jdbc.sql("UPDATE turno SET aviso_min_antes = :min, aviso_min_enviado_at = NULL WHERE id = :t").param("min", minAntes).param("t", turnoId).update();
    }

    @Override
    public List<Espera> esperas(int colaId, Instant desde) {
        return jdbc.sql("SELECT emitido_at, llamado_at FROM turno WHERE cola_id = :cola AND llamado_at IS NOT NULL AND emitido_at >= :desde")
                .param("cola", colaId).param("desde", Sql.utc(desde))
                .query((rs, n) -> new Espera(Sql.instante(rs, "emitido_at"), Sql.instante(rs, "llamado_at"))).list();
    }

    private static LogPrediccion log(ResultSet rs, int n) throws SQLException {
        return new LogPrediccion(Sql.instante(rs, "created_at"), Tipo.valueOf(rs.getString("tipo")), rs.getInt("delante"), rs.getInt("c"),
                rs.getInt("pred_seg"), rs.getInt("lo_seg"), rs.getInt("hi_seg"), Sql.entero(rs, "real_seg"));
    }

    private ModeloFila modelo(ResultSet rs, int n) throws SQLException {
        String imp = rs.getString("importancia");
        List<Importancia> importancia = imp == null ? null : json.readValue(imp, new TypeReference<List<Importancia>>() { });
        return new ModeloFila(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("cola_id"), Tipo.valueOf(rs.getString("tipo")), rs.getInt("version"),
                rs.getInt("n_muestras"), doble(rs, "mae"), doble(rs, "medae"), doble(rs, "acierto_5"), doble(rs, "sesgo"), doble(rs, "cobertura"),
                doble(rs, "ancho_medio"), importancia, rs.getBoolean("activo"), rs.getBoolean("deriva"), Sql.instante(rs, "entrenado_at"));
    }

    private static Double doble(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }
}
