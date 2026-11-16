package pe.turnoya.kiosco.infraestructura;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.kiosco.dominio.RepositorioKiosco;

/** Acceso a {@code dispositivo_kiosco} y {@code evento_kiosco} (y lectura breve de {@code turno}). */
@Repository
class KioscoJdbc implements RepositorioKiosco {

    private static final String DISPOSITIVO = """
            SELECT id, local_id, numero, nombre, cola_ids, token_hash, codigo_emparej_hash, codigo_emparej_expira, pin_mantenimiento, activo,
                   version_app, ultimo_heartbeat_at, offset_reloj_ms, pendientes_reportados, impresora, config_version, en_linea
              FROM dispositivo_kiosco
            """;

    private static final String EVENTO = """
            SELECT id, dispositivo_id, clave_idem, seq, tipo, payload::text AS payload, ts_dispositivo, offset_ms_al_emitir, ts_corregido,
                   estado::text AS estado, motivo, turno_id
              FROM evento_kiosco
            """;

    private final JdbcClient jdbc;

    KioscoJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // --- Dispositivos ---

    @Override
    public int contarActivos(int localId) {
        return jdbc.sql("SELECT COUNT(*) FROM dispositivo_kiosco WHERE local_id = ? AND activo").param(localId).query(Integer.class).single();
    }

    @Override
    public int siguienteNumero(int localId) {
        return jdbc.sql("SELECT COALESCE(MAX(numero), 0) + 1 FROM dispositivo_kiosco WHERE local_id = ?").param(localId).query(Integer.class).single();
    }

    @Override
    public int crear(int localId, int numero, String nombre, List<Integer> colaIds, String pinHash) {
        return jdbc.sql("""
                        INSERT INTO dispositivo_kiosco (local_id, numero, nombre, cola_ids, pin_mantenimiento)
                        VALUES (?, ?, ?, CAST(? AS int[]), ?) RETURNING id""")
                .params(localId, numero, nombre, arreglo(colaIds), pinHash).query(Integer.class).single();
    }

    @Override
    public Optional<Dispositivo> dispositivo(int id) {
        return jdbc.sql(DISPOSITIVO + " WHERE id = ?").param(id).query(KioscoJdbc::dispositivo).optional();
    }

    @Override
    public Optional<Dispositivo> dispositivoDelLocal(int localId, int id) {
        return jdbc.sql(DISPOSITIVO + " WHERE id = ? AND local_id = ?").params(id, localId).query(KioscoJdbc::dispositivo).optional();
    }

    @Override
    public List<Dispositivo> dispositivos(int localId) {
        return jdbc.sql(DISPOSITIVO + " WHERE local_id = ? ORDER BY numero").param(localId).query(KioscoJdbc::dispositivo).list();
    }

    @Override
    public Optional<Dispositivo> porToken(String tokenHash) {
        return jdbc.sql(DISPOSITIVO + " WHERE token_hash = ? AND activo").param(tokenHash).query(KioscoJdbc::dispositivo).optional();
    }

    @Override
    public List<Dispositivo> conCodigoVigente() {
        return jdbc.sql(DISPOSITIVO + " WHERE codigo_emparej_hash IS NOT NULL AND activo").query(KioscoJdbc::dispositivo).list();
    }

    @Override
    public void guardarCodigo(int id, String codigoHash, Instant expira) {
        jdbc.sql("UPDATE dispositivo_kiosco SET codigo_emparej_hash = ?, codigo_emparej_expira = ? WHERE id = ?")
                .params(codigoHash, Sql.utc(expira), id).update();
    }

    @Override
    public void editar(int id, String nombre, List<Integer> colaIds, Boolean activo, String pinHash) {
        jdbc.sql("""
                        UPDATE dispositivo_kiosco
                           SET nombre = COALESCE(CAST(:nombre AS text), nombre),
                               cola_ids = COALESCE(CAST(:colas AS int[]), cola_ids),
                               activo = COALESCE(CAST(:activo AS boolean), activo),
                               token_hash = CASE WHEN CAST(:activo AS boolean) = false THEN NULL ELSE token_hash END,
                               en_linea = CASE WHEN CAST(:activo AS boolean) = false THEN false ELSE en_linea END,
                               pin_mantenimiento = COALESCE(CAST(:pin AS text), pin_mantenimiento),
                               config_version = config_version + 1
                         WHERE id = :id""")
                .param("nombre", nombre).param("colas", colaIds == null ? null : arreglo(colaIds)).param("activo", activo).param("pin", pinHash)
                .param("id", id).update();
    }

    @Override
    public void revocarToken(int id) {
        jdbc.sql("UPDATE dispositivo_kiosco SET token_hash = NULL, en_linea = false, activo = true WHERE id = ?").param(id).update();
    }

    @Override
    public void emparejar(int id, String tokenHash, Instant ahora) {
        jdbc.sql("""
                        UPDATE dispositivo_kiosco SET token_hash = ?, codigo_emparej_hash = NULL, codigo_emparej_expira = NULL, en_linea = true,
                               ultimo_heartbeat_at = ? WHERE id = ?""")
                .params(tokenHash, Sql.utc(ahora), id).update();
    }

    @Override
    public boolean latido(int id, Instant ahora, int pendientes, String version, String impresora, Integer offsetMs) {
        Boolean antes = jdbc.sql("SELECT en_linea FROM dispositivo_kiosco WHERE id = ?").param(id).query(Boolean.class).single();
        jdbc.sql("""
                        UPDATE dispositivo_kiosco SET ultimo_heartbeat_at = :ahora, en_linea = true, pendientes_reportados = :pend, version_app = :version,
                               impresora = :impresora, offset_reloj_ms = COALESCE(CAST(:offset AS int), offset_reloj_ms) WHERE id = :id""")
                .param("ahora", Sql.utc(ahora)).param("pend", pendientes).param("version", version).param("impresora", impresora)
                .param("offset", offsetMs).param("id", id).update();
        return !Boolean.TRUE.equals(antes);
    }

    @Override
    public List<Dispositivo> sinLatidoDesde(Instant limite) {
        return jdbc.sql(DISPOSITIVO + " WHERE en_linea AND (ultimo_heartbeat_at IS NULL OR ultimo_heartbeat_at < ?)").param(Sql.utc(limite))
                .query(KioscoJdbc::dispositivo).list();
    }

    @Override
    public void marcarSinConexion(int id) {
        jdbc.sql("UPDATE dispositivo_kiosco SET en_linea = false WHERE id = ?").param(id).update();
    }

    @Override
    public int colasDelLocal(int localId, List<Integer> colaIds) {
        return jdbc.sql("SELECT COUNT(*) FROM cola WHERE local_id = ? AND id = ANY(CAST(? AS int[]))").params(localId, arreglo(colaIds))
                .query(Integer.class).single();
    }

    // --- Eventos ---

    @Override
    public boolean insertarEvento(int dispositivoId, String claveIdem, int seq, String tipo, String payloadJson, Instant tsDispositivo, int offsetMs) {
        return jdbc.sql("""
                        INSERT INTO evento_kiosco (dispositivo_id, clave_idem, seq, tipo, payload, ts_dispositivo, offset_ms_al_emitir)
                        VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?) ON CONFLICT (clave_idem) DO NOTHING""")
                .params(dispositivoId, claveIdem, seq, tipo, payloadJson, Sql.utc(tsDispositivo), offsetMs).update() > 0;
    }

    @Override
    public Optional<Evento> evento(String claveIdem) {
        return jdbc.sql(EVENTO + " WHERE clave_idem = ?").param(claveIdem).query(KioscoJdbc::evento).optional();
    }

    @Override
    public Optional<Evento> eventoDelLocal(int localId, long id) {
        return jdbc.sql(EVENTO + " WHERE id = ? AND dispositivo_id IN (SELECT id FROM dispositivo_kiosco WHERE local_id = ?)").params(id, localId)
                .query(KioscoJdbc::evento).optional();
    }

    @Override
    public Optional<Instant> ultimoTsCorregido(int dispositivoId, long exceptoEventoId) {
        return jdbc.sql("SELECT MAX(ts_corregido) AS t FROM evento_kiosco WHERE dispositivo_id = ? AND id <> ? AND ts_corregido IS NOT NULL")
                .params(dispositivoId, exceptoEventoId).query((rs, n) -> Sql.instante(rs, "t")).optional().filter(t -> t != null);
    }

    @Override
    public void marcarEvento(long id, String estado, String motivo, Integer turnoId, Instant tsCorregido, String payloadJson) {
        jdbc.sql("""
                        UPDATE evento_kiosco SET estado = CAST(:estado AS "EstadoEventoKiosco"), motivo = CAST(:motivo AS text), turno_id = CAST(:turno AS int), ts_corregido = CAST(:ts AS timestamp),
                               payload = COALESCE(CAST(:payload AS jsonb), payload) WHERE id = :id""")
                .param("estado", estado).param("motivo", motivo).param("turno", turnoId).param("ts", Sql.utc(tsCorregido)).param("payload", payloadJson)
                .param("id", id).update();
    }

    @Override
    public void resolverEvento(long id, String estado, Integer turnoId, int usuarioId, Instant ahora, String payloadJson) {
        jdbc.sql("""
                        UPDATE evento_kiosco SET estado = CAST(:estado AS "EstadoEventoKiosco"), turno_id = COALESCE(CAST(:turno AS int), turno_id), resuelto_por = :usuario,
                               resuelto_at = :ahora, payload = CAST(:payload AS jsonb) WHERE id = :id""")
                .param("estado", estado).param("turno", turnoId).param("usuario", usuarioId).param("ahora", Sql.utc(ahora)).param("payload", payloadJson)
                .param("id", id).update();
    }

    @Override
    public List<EventoListado> eventos(int localId, String estado, Integer dispositivoId, Long cursor, int limite) {
        return jdbc.sql("""
                        SELECT e.id, d.numero, d.nombre, e.seq, e.tipo, e.estado::text AS estado, e.motivo, e.ts_dispositivo, e.ts_corregido, e.recibido_at,
                               e.turno_id, (e.payload->>'colaId')::int AS cola_id
                          FROM evento_kiosco e JOIN dispositivo_kiosco d ON d.id = e.dispositivo_id
                         WHERE d.local_id = :local
                           AND (CAST(:estado AS text) IS NULL OR e.estado::text = :estado)
                           AND (CAST(:disp AS int) IS NULL OR e.dispositivo_id = :disp)
                           AND (CAST(:cursor AS bigint) IS NULL OR e.id < :cursor)
                         ORDER BY e.id DESC LIMIT :limite""")
                .param("local", localId).param("estado", estado).param("disp", dispositivoId).param("cursor", cursor).param("limite", limite)
                .query((rs, n) -> new EventoListado(rs.getLong("id"), rs.getInt("numero"), rs.getString("nombre"), rs.getInt("seq"), rs.getString("tipo"),
                        rs.getString("estado"), rs.getString("motivo"), Sql.instante(rs, "ts_dispositivo"), Sql.instante(rs, "ts_corregido"),
                        Sql.instante(rs, "recibido_at"), Sql.entero(rs, "turno_id"), Sql.entero(rs, "cola_id")))
                .list();
    }

    @Override
    public List<Evento> eventosPorSeq(int dispositivoId, int seq) {
        return jdbc.sql(EVENTO + " WHERE dispositivo_id = ? AND seq = ? ORDER BY id DESC").params(dispositivoId, seq).query(KioscoJdbc::evento).list();
    }

    @Override
    public int borrarEventosAntiguos(Instant antesDe) {
        return jdbc.sql("DELETE FROM evento_kiosco WHERE estado IN ('APLICADO', 'DUPLICADO', 'RECHAZADO') AND recibido_at < ?")
                .param(Sql.utc(antesDe)).update();
    }

    @Override
    public Optional<TurnoBreve> turno(int turnoId) {
        return jdbc.sql("SELECT id, codigo, token FROM turno WHERE id = ?").param(turnoId)
                .query((rs, n) -> new TurnoBreve(rs.getInt("id"), rs.getString("codigo"), rs.getString("token"))).optional();
    }

    @Override
    public Optional<TurnoBreve> turnoPorToken(String token) {
        return jdbc.sql("SELECT id, codigo, token FROM turno WHERE token = ?").param(token)
                .query((rs, n) -> new TurnoBreve(rs.getInt("id"), rs.getString("codigo"), rs.getString("token"))).optional();
    }

    // --- Mapeo ---

    private static Dispositivo dispositivo(ResultSet rs, int n) throws SQLException {
        return new Dispositivo(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("numero"), rs.getString("nombre"), enteros(rs.getArray("cola_ids")),
                rs.getString("token_hash"), rs.getString("codigo_emparej_hash"), Sql.instante(rs, "codigo_emparej_expira"), rs.getString("pin_mantenimiento"),
                rs.getBoolean("activo"), rs.getString("version_app"), Sql.instante(rs, "ultimo_heartbeat_at"), rs.getInt("offset_reloj_ms"),
                rs.getInt("pendientes_reportados"), rs.getString("impresora"), rs.getInt("config_version"), rs.getBoolean("en_linea"));
    }

    private static Evento evento(ResultSet rs, int n) throws SQLException {
        return new Evento(rs.getLong("id"), rs.getInt("dispositivo_id"), rs.getString("clave_idem"), rs.getInt("seq"), rs.getString("tipo"),
                rs.getString("payload"), Sql.instante(rs, "ts_dispositivo"), rs.getInt("offset_ms_al_emitir"), Sql.instante(rs, "ts_corregido"),
                rs.getString("estado"), rs.getString("motivo"), Sql.entero(rs, "turno_id"));
    }

    private static String arreglo(List<Integer> xs) {
        return "{" + xs.stream().map(String::valueOf).collect(Collectors.joining(",")) + "}";
    }

    private static List<Integer> enteros(Array a) throws SQLException {
        if (a == null) {
            return List.of();
        }
        return Arrays.stream((Object[]) a.getArray()).map(x -> ((Number) x).intValue()).toList();
    }
}
