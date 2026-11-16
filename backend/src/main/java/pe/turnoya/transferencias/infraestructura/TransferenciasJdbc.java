package pe.turnoya.transferencias.infraestructura;

import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.transferencias.dominio.RepositorioTransferencias;

/** Acceso a la tabla {@code transferencia} y a las lecturas de {@code turno} y {@code cola} de M6. */
@Repository
class TransferenciasJdbc implements RepositorioTransferencias {

    private final JdbcClient jdbc;

    TransferenciasJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

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
    public Map<Integer, String> colas(int localId) {
        Map<Integer, String> m = new LinkedHashMap<>();
        jdbc.sql("SELECT id, nombre FROM cola WHERE local_id = ? AND activa ORDER BY orden, id").param(localId)
                .query((rs, i) -> m.put(rs.getInt("id"), rs.getString("nombre"))).list();
        return m;
    }

    @Override
    public boolean ventanillaActiva(int id, int localId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM ventanilla WHERE id = :id AND local_id = :local AND activa)")
                .param("id", id).param("local", localId).query(Boolean.class).single();
    }

    @Override
    public void registrarTransferencia(NuevaTransferencia t) {
        jdbc.sql("""
                        INSERT INTO transferencia (local_id, turno_origen_id, turno_destino_id, de_cola_id, a_cola_id, a_ventanilla_id, motivo, detalle,
                                                   origen, usuario_id)
                        VALUES (:local, :o, :d, :de, :a, CAST(:v AS int), :motivo, :detalle, 'MANUAL', CAST(:usuario AS int))""")
                .param("local", t.localId()).param("o", t.turnoOrigenId()).param("d", t.turnoDestinoId()).param("de", t.deColaId())
                .param("a", t.aColaId()).param("v", t.aVentanillaId()).param("motivo", t.motivo()).param("detalle", t.detalle())
                .param("usuario", t.usuarioId())
                .update();
    }

    @Override
    public List<Transferencia> transferencias(int localId, Instant desde, Instant hasta, Integer cursor, int limite) {
        return jdbc.sql("""
                        SELECT x.id, x.turno_origen_id, x.turno_destino_id, o.codigo AS cod_o, d.codigo AS cod_d, cd.nombre AS de_cola, ca.nombre AS a_cola,
                               x.motivo, x.detalle, x.origen::text AS origen, x.usuario_id, u.nombre AS usuario, x.created_at
                          FROM transferencia x
                          JOIN turno o ON o.id = x.turno_origen_id JOIN turno d ON d.id = x.turno_destino_id
                          LEFT JOIN cola cd ON cd.id = x.de_cola_id LEFT JOIN cola ca ON ca.id = x.a_cola_id
                          LEFT JOIN usuario u ON u.id = x.usuario_id
                         WHERE x.local_id = :local AND (CAST(:desde AS timestamp) IS NULL OR x.created_at >= CAST(:desde AS timestamp))
                           AND (CAST(:hasta AS timestamp) IS NULL OR x.created_at <= CAST(:hasta AS timestamp))
                           AND (CAST(:cursor AS int) IS NULL OR x.id < :cursor)
                         ORDER BY x.id DESC LIMIT :limite
                        """)
                .param("local", localId).param("desde", utc(desde)).param("hasta", utc(hasta)).param("cursor", cursor).param("limite", limite)
                .query((rs, i) -> new Transferencia(rs.getInt("id"), rs.getInt("turno_origen_id"), rs.getInt("turno_destino_id"), rs.getString("cod_o"),
                        rs.getString("cod_d"), rs.getString("de_cola"), rs.getString("a_cola"), rs.getString("motivo"), rs.getString("detalle"),
                        rs.getString("origen"), Sql.entero(rs, "usuario_id"), rs.getString("usuario"), Sql.instante(rs, "created_at")))
                .list();
    }

    private static Object utc(Instant i) {
        return i == null ? null : Sql.utc(i);
    }
}
