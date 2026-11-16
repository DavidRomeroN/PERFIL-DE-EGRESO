package pe.turnoya.nucleo.infraestructura;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.nucleo.dominio.RepositorioApp;

/** Tablas de la app móvil: {@code app_codigo}, {@code app_sesion} y {@code turno_app}. */
@Repository
class AppJdbc implements RepositorioApp {

    private final JdbcClient jdbc;

    AppJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<CodigoPendiente> codigo(String telefonoHash) {
        return jdbc.sql("SELECT codigo_hash, intentos, expira_at, creado_at FROM app_codigo WHERE telefono_hash = :t")
                .param("t", telefonoHash)
                .query((rs, i) -> new CodigoPendiente(rs.getString("codigo_hash"), rs.getInt("intentos"), Sql.instante(rs, "expira_at"),
                        Sql.instante(rs, "creado_at")))
                .optional();
    }

    @Override
    public void guardarCodigo(String telefonoHash, String codigoHash, Instant expira, Instant ahora) {
        jdbc.sql("""
                        INSERT INTO app_codigo (telefono_hash, codigo_hash, intentos, expira_at, creado_at)
                        VALUES (:t, :c, 0, :expira, :ahora)
                        ON CONFLICT (telefono_hash)
                        DO UPDATE SET codigo_hash = EXCLUDED.codigo_hash, intentos = 0, expira_at = EXCLUDED.expira_at, creado_at = EXCLUDED.creado_at
                        """)
                .param("t", telefonoHash).param("c", codigoHash).param("expira", Sql.utc(expira)).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public void sumarIntento(String telefonoHash) {
        jdbc.sql("UPDATE app_codigo SET intentos = intentos + 1 WHERE telefono_hash = :t").param("t", telefonoHash).update();
    }

    @Override
    public void borrarCodigo(String telefonoHash) {
        jdbc.sql("DELETE FROM app_codigo WHERE telefono_hash = :t").param("t", telefonoHash).update();
    }

    @Override
    public int borrarCodigosVencidos(Instant antes) {
        return jdbc.sql("DELETE FROM app_codigo WHERE expira_at < :antes").param("antes", Sql.utc(antes)).update();
    }

    @Override
    public void crearSesion(String tokenHash, int clienteId, String dispositivoHash, Instant ahora) {
        jdbc.sql("""
                        INSERT INTO app_sesion (token_hash, cliente_id, dispositivo_hash, creada_at, ultimo_uso_at)
                        VALUES (:t, :cliente, :d, :ahora, :ahora)
                        """)
                .param("t", tokenHash).param("cliente", clienteId).param("d", dispositivoHash).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public Optional<Integer> clienteDeSesion(String tokenHash, Instant ahora) {
        return jdbc.sql("""
                        UPDATE app_sesion SET ultimo_uso_at = :ahora
                         WHERE token_hash = :t AND revocada_at IS NULL
                        RETURNING cliente_id
                        """)
                .param("t", tokenHash).param("ahora", Sql.utc(ahora)).query(Integer.class).optional();
    }

    @Override
    public void revocarSesion(String tokenHash, Instant ahora) {
        jdbc.sql("UPDATE app_sesion SET revocada_at = :ahora WHERE token_hash = :t AND revocada_at IS NULL")
                .param("t", tokenHash).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public void bloquearDispositivo(String dispositivoHash) {
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext(:k))").param("k", "app:" + dispositivoHash).query((rs, i) -> 0).list();
    }

    @Override
    public Optional<TurnoActivo> activoDeDispositivo(int colaId, String dispositivoHash) {
        return jdbc.sql("""
                        SELECT t.codigo, t.token
                          FROM turno_app a JOIN turno t ON t.id = a.turno_id
                         WHERE a.dispositivo_hash = :d AND t.cola_id = :cola AND t.estado IN ('EMITIDO', 'AVISADO', 'LLAMADO')
                         LIMIT 1
                        """)
                .param("d", dispositivoHash).param("cola", colaId)
                .query((rs, i) -> new TurnoActivo(rs.getString("codigo"), rs.getString("token")))
                .optional();
    }

    @Override
    public void registrarTurno(int turnoId, String dispositivoHash, Instant ahora) {
        jdbc.sql("INSERT INTO turno_app (turno_id, dispositivo_hash, creado_at) VALUES (:t, :d, :ahora)")
                .param("t", turnoId).param("d", dispositivoHash).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public Optional<Integer> idDeTurno(String token) {
        return jdbc.sql("SELECT id FROM turno WHERE token = :t").param("t", token).query(Integer.class).optional();
    }

    @Override
    public List<Falta> faltas(String dispositivoHash, Integer clienteId, Instant desde, int limite) {
        return jdbc.sql("""
                        SELECT t.emitido_at, t.codigo, c.nombre AS cola, l.nombre_comercial AS local
                          FROM turno t
                          JOIN cola c ON c.id = t.cola_id
                          JOIN local l ON l.id = t.local_id
                          LEFT JOIN turno_app a ON a.turno_id = t.id
                         WHERE t.estado = 'NO_SE_PRESENTO' AND t.emitido_at >= :desde
                           AND (a.dispositivo_hash = :d OR (CAST(:cliente AS integer) IS NOT NULL AND t.cliente_id = :cliente))
                         ORDER BY t.emitido_at DESC
                         LIMIT :limite
                        """)
                .param("desde", Sql.utc(desde)).param("d", dispositivoHash).param("cliente", clienteId).param("limite", limite)
                .query((rs, i) -> new Falta(Sql.instante(rs, "emitido_at"), rs.getString("codigo"), rs.getString("cola"), rs.getString("local")))
                .list();
    }

    @Override
    public int activos(String dispositivoHash, Integer clienteId, Instant desde) {
        return jdbc.sql("""
                        SELECT count(*)
                          FROM turno t LEFT JOIN turno_app a ON a.turno_id = t.id
                         WHERE t.estado IN ('EMITIDO', 'AVISADO', 'LLAMADO') AND t.emitido_at >= :desde
                           AND (a.dispositivo_hash = :d OR (CAST(:cliente AS integer) IS NOT NULL AND t.cliente_id = :cliente))
                        """)
                .param("desde", Sql.utc(desde)).param("d", dispositivoHash).param("cliente", clienteId)
                .query(Integer.class).single();
    }

    @Override
    public int crearCliente(String nombre, Instant ahora) {
        return jdbc.sql("INSERT INTO cliente (nombre, consentimiento_at, created_at) VALUES (:nombre, :ahora, :ahora) RETURNING id")
                .param("nombre", nombre).param("ahora", Sql.utc(ahora)).query(Integer.class).single();
    }

    @Override
    public void crearCuenta(int clienteId, String correo, String claveHash, Instant ahora) {
        jdbc.sql("INSERT INTO cuenta_app (cliente_id, correo, clave_hash, creada_at) VALUES (:cliente, :correo, :clave, :ahora)")
                .param("cliente", clienteId).param("correo", correo).param("clave", claveHash).param("ahora", Sql.utc(ahora)).update();
    }

    @Override
    public Optional<CuentaCorreo> cuentaPorCorreo(String correo) {
        return jdbc.sql("""
                        SELECT cliente_id, correo, clave_hash, intentos_fallidos, bloqueada_hasta
                          FROM cuenta_app WHERE lower(correo) = lower(:correo)
                        """)
                .param("correo", correo)
                .query((rs, i) -> new CuentaCorreo(rs.getInt("cliente_id"), rs.getString("correo"), rs.getString("clave_hash"),
                        rs.getInt("intentos_fallidos"), Sql.instante(rs, "bloqueada_hasta")))
                .optional();
    }

    @Override
    public void anotarFallo(int clienteId, int intentos, Instant bloqueadaHasta) {
        jdbc.sql("UPDATE cuenta_app SET intentos_fallidos = :intentos, bloqueada_hasta = :hasta WHERE cliente_id = :cliente")
                .param("intentos", intentos).param("hasta", bloqueadaHasta == null ? null : Sql.utc(bloqueadaHasta)).param("cliente", clienteId)
                .update();
    }

    @Override
    public void anotarIngreso(int clienteId, Instant ahora) {
        jdbc.sql("UPDATE cuenta_app SET intentos_fallidos = 0, bloqueada_hasta = NULL, ultimo_ingreso_at = :ahora WHERE cliente_id = :cliente")
                .param("ahora", Sql.utc(ahora)).param("cliente", clienteId).update();
    }

    @Override
    public Optional<DatosCliente> datosCliente(int clienteId) {
        return jdbc.sql("""
                        SELECT c.nombre, a.correo, c.telefono_cifrado, COALESCE(a.creada_at, c.created_at) AS creado
                          FROM cliente c LEFT JOIN cuenta_app a ON a.cliente_id = c.id
                         WHERE c.id = :cliente
                        """)
                .param("cliente", clienteId)
                .query((rs, i) -> new DatosCliente(rs.getString("nombre"), rs.getString("correo"), rs.getString("telefono_cifrado"),
                        Sql.instante(rs, "creado")))
                .optional();
    }

    @Override
    public List<TurnoDeCliente> turnosDeCliente(int clienteId, int limite) {
        // El token solo sale para los turnos activos: con él se sigue y se cancela el turno
        return jdbc.sql("""
                        SELECT CASE WHEN t.estado IN ('EMITIDO', 'AVISADO', 'LLAMADO') THEN t.token END AS token,
                               t.codigo, t.estado, t.canal, t.emitido_at, c.nombre AS cola, l.nombre_comercial AS local, l.slug
                          FROM turno t
                          JOIN cola c ON c.id = t.cola_id
                          JOIN local l ON l.id = t.local_id
                         WHERE t.cliente_id = :cliente AND t.estado <> 'TRANSFERIDO'
                         ORDER BY t.emitido_at DESC
                         LIMIT :limite
                        """)
                .param("cliente", clienteId).param("limite", limite)
                .query((rs, i) -> new TurnoDeCliente(rs.getString("token"), rs.getString("codigo"), rs.getString("estado"), rs.getString("canal"),
                        Sql.instante(rs, "emitido_at"), rs.getString("cola"), rs.getString("local"), rs.getString("slug")))
                .list();
    }
}
