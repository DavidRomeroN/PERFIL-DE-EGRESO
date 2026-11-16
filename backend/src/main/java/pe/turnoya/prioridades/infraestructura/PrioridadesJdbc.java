package pe.turnoya.prioridades.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.prioridades.dominio.ReglasPrioridad;
import pe.turnoya.prioridades.dominio.RepositorioPrioridades;

/** Acceso a {@code categoria_prioridad}, {@code config_prioridad} y a las columnas de prioridad de {@code turno}. */
@Repository
class PrioridadesJdbc implements RepositorioPrioridades {

    private static final String COLUMNAS = """
            cp.id, cp.codigo, cp.nombre, cp.icono, cp.peso_base, cp.absoluta, cp.documento::text AS documento, cp.espera_max_seg,
            cp.visible_cliente, cp.activa, cp.orden""";

    /** Categorías por defecto de un local nuevo (mismas que el sistema anterior). */
    private static final List<DatosCategoria> POR_DEFECTO = List.of(
            new DatosCategoria("GENERAL", "General", null, 0, false, "NINGUNO", null, true, true, 0),
            new DatosCategoria("ADULTO_MAYOR", "Adulto mayor (60+)", null, 60, false, "DNI", 1800, true, true, 1),
            new DatosCategoria("GESTANTE", "Gestante", null, 60, false, "CARNE_GESTANTE", 1800, true, true, 2),
            new DatosCategoria("DISCAPACIDAD", "Persona con discapacidad", null, 50, false, "CONADIS", 1800, true, true, 3),
            new DatosCategoria("EMERGENCIA", "Emergencia", null, 100, true, "TRIAJE", 0, false, true, 4),
            new DatosCategoria("CITA", "Cita reservada", null, 80, false, "NINGUNO", null, false, true, 5));

    private final JdbcClient jdbc;

    PrioridadesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public ReglasPrioridad.Config config(int localId) {
        return jdbc.sql("SELECT alfa_puntos_por_min, tope_adelantos, aging_activo FROM config_prioridad WHERE local_id = :local")
                .param("local", localId)
                .query((rs, i) -> new ReglasPrioridad.Config(rs.getDouble(1), rs.getInt(2), rs.getBoolean(3)))
                .optional().orElse(new ReglasPrioridad.Config(0, 0, false));
    }

    @Override
    public void guardarConfig(int localId, ReglasPrioridad.Config c) {
        jdbc.sql("""
                        INSERT INTO config_prioridad (local_id, alfa_puntos_por_min, tope_adelantos, aging_activo) VALUES (:local, :alfa, :tope, :aging)
                        ON CONFLICT (local_id) DO UPDATE SET alfa_puntos_por_min = EXCLUDED.alfa_puntos_por_min, tope_adelantos = EXCLUDED.tope_adelantos,
                               aging_activo = EXCLUDED.aging_activo, actualizado_at = now()""")
                .param("local", localId).param("alfa", c.alfa()).param("tope", c.tope()).param("aging", c.aging())
                .update();
    }

    @Override
    public List<CategoriaFila> categorias(int localId) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM categoria_prioridad cp WHERE cp.local_id = :local ORDER BY cp.orden, cp.id")
                .param("local", localId).query(PrioridadesJdbc::categoria).list();
    }

    @Override
    public Optional<CategoriaFila> categoria(int localId, int id) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM categoria_prioridad cp WHERE cp.local_id = :local AND cp.id = :id")
                .param("local", localId).param("id", id).query(PrioridadesJdbc::categoria).optional();
    }

    @Override
    public Optional<CategoriaFila> activaPorCodigo(int localId, String codigo) {
        return jdbc.sql("SELECT " + COLUMNAS + " FROM categoria_prioridad cp WHERE cp.local_id = :local AND cp.codigo = :codigo AND cp.activa")
                .param("local", localId).param("codigo", codigo).query(PrioridadesJdbc::categoria).optional();
    }

    @Override
    public int preferentesActivas(int localId, Integer excepto) {
        return jdbc.sql("""
                        SELECT count(*) FROM categoria_prioridad
                         WHERE local_id = :local AND activa AND codigo NOT IN ('GENERAL', 'CITA')
                           AND (CAST(:excepto AS int) IS NULL OR id <> :excepto)""")
                .param("local", localId).param("excepto", excepto).query(Integer.class).single();
    }

    @Override
    public CategoriaFila crear(int localId, DatosCategoria d) {
        int id = jdbc.sql("""
                        INSERT INTO categoria_prioridad (local_id, codigo, nombre, icono, peso_base, absoluta, documento, espera_max_seg,
                                                         visible_cliente, activa, orden)
                        VALUES (:local, :codigo, :nombre, :icono, :peso, :absoluta, CAST(:documento AS "DocumentoPrioridad"), :espera,
                                :visible, :activa, :orden)
                        RETURNING id""")
                .param("local", localId).param("codigo", d.codigo()).param("nombre", d.nombre()).param("icono", d.icono())
                .param("peso", d.pesoBase()).param("absoluta", d.absoluta()).param("documento", d.documento()).param("espera", d.esperaMaxSeg())
                .param("visible", d.visibleCliente()).param("activa", d.activa()).param("orden", d.orden())
                .query(Integer.class).single();
        return categoria(localId, id).orElseThrow();
    }

    @Override
    public CategoriaFila editar(int id, DatosCategoria d) {
        jdbc.sql("""
                        UPDATE categoria_prioridad SET nombre = :nombre, icono = :icono, peso_base = :peso, absoluta = :absoluta,
                               documento = CAST(:documento AS "DocumentoPrioridad"), espera_max_seg = :espera, visible_cliente = :visible,
                               activa = :activa, orden = :orden
                         WHERE id = :id""")
                .param("nombre", d.nombre()).param("icono", d.icono()).param("peso", d.pesoBase()).param("absoluta", d.absoluta())
                .param("documento", d.documento()).param("espera", d.esperaMaxSeg()).param("visible", d.visibleCliente())
                .param("activa", d.activa()).param("orden", d.orden()).param("id", id)
                .update();
        return jdbc.sql("SELECT " + COLUMNAS + " FROM categoria_prioridad cp WHERE cp.id = :id").param("id", id).query(PrioridadesJdbc::categoria).single();
    }

    @Override
    public int turnosConCategoria(int id) {
        return jdbc.sql("SELECT count(*) FROM turno WHERE categoria_id = :id").param("id", id).query(Integer.class).single();
    }

    @Override
    public void desactivar(int id) {
        jdbc.sql("UPDATE categoria_prioridad SET activa = false WHERE id = :id").param("id", id).update();
    }

    @Override
    public void eliminar(int id) {
        jdbc.sql("DELETE FROM categoria_prioridad WHERE id = :id").param("id", id).update();
    }

    @Override
    public void sembrar(int localId) {
        for (DatosCategoria d : POR_DEFECTO) {
            jdbc.sql("""
                            INSERT INTO categoria_prioridad (local_id, codigo, nombre, peso_base, absoluta, documento, espera_max_seg, visible_cliente,
                                                             activa, orden)
                            VALUES (:local, :codigo, :nombre, :peso, :absoluta, CAST(:documento AS "DocumentoPrioridad"), :espera, :visible, true, :orden)
                            ON CONFLICT (local_id, codigo) DO NOTHING""")
                    .param("local", localId).param("codigo", d.codigo()).param("nombre", d.nombre()).param("peso", d.pesoBase())
                    .param("absoluta", d.absoluta()).param("documento", d.documento()).param("espera", d.esperaMaxSeg())
                    .param("visible", d.visibleCliente()).param("orden", d.orden())
                    .update();
        }
        jdbc.sql("INSERT INTO config_prioridad (local_id) VALUES (:local) ON CONFLICT (local_id) DO NOTHING").param("local", localId).update();
    }

    @Override
    public int recalcular(int localId, LocalDate fecha) {
        return jdbc.sql("SELECT recalcular_claves(:local, CAST(:fecha AS date))")
                .param("local", localId).param("fecha", fecha).query(Integer.class).single();
    }

    private static final String TURNO = """
            SELECT t.id, t.codigo, t.cola_id, t.estado::text AS estado, t.emitido_at, t.prioridad_verificada, t.categoria_id,
                   cp.id AS c_id, cp.codigo AS c_codigo, cp.nombre AS c_nombre, cp.icono AS c_icono, cp.peso_base AS c_peso, cp.absoluta AS c_absoluta,
                   cp.documento::text AS c_documento, cp.espera_max_seg AS c_espera, cp.visible_cliente AS c_visible, cp.activa AS c_activa,
                   cp.orden AS c_orden
              FROM turno t LEFT JOIN categoria_prioridad cp ON cp.id = t.categoria_id
            """;

    @Override
    public Optional<TurnoEspera> turno(int localId, int turnoId) {
        return jdbc.sql(TURNO + " WHERE t.id = :id AND t.local_id = :local")
                .param("id", turnoId).param("local", localId).query(PrioridadesJdbc::turno).optional();
    }

    @Override
    public Optional<TurnoEspera> siguiente(int localId, LocalDate fecha, Integer colaId) {
        return jdbc.sql(TURNO + """
                         WHERE t.local_id = :local AND t.fecha = CAST(:fecha AS date) AND t.estado IN ('EMITIDO', 'AVISADO')
                           AND (CAST(:cola AS int) IS NULL OR t.cola_id = :cola)
                         ORDER BY t.clave_orden DESC, t.emitido_at ASC, t.id ASC LIMIT 1""")
                .param("local", localId).param("fecha", fecha).param("cola", colaId)
                .query(PrioridadesJdbc::turno).optional();
    }

    @Override
    public void verificar(int turnoId) {
        jdbc.sql("UPDATE turno SET prioridad_verificada = true WHERE id = :id").param("id", turnoId).update();
    }

    @Override
    public void cambiarCategoria(int localId, int turnoId, Integer categoriaId, boolean verificada) {
        jdbc.sql("""
                        UPDATE turno SET categoria_id = CAST(:categoria AS int), prioridad_verificada = :verificada,
                               clave_orden = calcular_clave_orden(peso_categoria(CAST(:categoria AS int)), emitido_at AT TIME ZONE 'UTC',
                                   COALESCE((SELECT alfa_puntos_por_min FROM config_prioridad WHERE local_id = :local), 0),
                                   COALESCE((SELECT aging_activo FROM config_prioridad WHERE local_id = :local), false))
                         WHERE id = :id""")
                .param("categoria", categoriaId).param("verificada", verificada).param("local", localId).param("id", turnoId)
                .update();
    }

    private static CategoriaFila categoria(ResultSet rs, int i) throws SQLException {
        return new CategoriaFila(rs.getInt("id"), rs.getString("codigo"), rs.getString("nombre"), rs.getString("icono"), rs.getInt("peso_base"),
                rs.getBoolean("absoluta"), rs.getString("documento"), Sql.entero(rs, "espera_max_seg"), rs.getBoolean("visible_cliente"),
                rs.getBoolean("activa"), rs.getInt("orden"));
    }

    private static TurnoEspera turno(ResultSet rs, int i) throws SQLException {
        CategoriaFila c = rs.getObject("c_id") == null ? null : new CategoriaFila(rs.getInt("c_id"), rs.getString("c_codigo"), rs.getString("c_nombre"),
                rs.getString("c_icono"), rs.getInt("c_peso"), rs.getBoolean("c_absoluta"), rs.getString("c_documento"), Sql.entero(rs, "c_espera"),
                rs.getBoolean("c_visible"), rs.getBoolean("c_activa"), rs.getInt("c_orden"));
        Object verificada = rs.getObject("prioridad_verificada");
        return new TurnoEspera(rs.getInt("id"), rs.getString("codigo"), rs.getInt("cola_id"), rs.getString("estado"), Sql.instante(rs, "emitido_at"), c,
                verificada == null ? null : (Boolean) verificada);
    }
}
