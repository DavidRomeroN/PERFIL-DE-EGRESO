package pe.turnoya.citas.infraestructura;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.citas.dominio.ReglasCitas.EstadoCita;
import pe.turnoya.citas.dominio.ReglasCitas.Rango;
import pe.turnoya.citas.dominio.ReglasCitas.Tramo;
import pe.turnoya.citas.dominio.RepositorioCitas;
import pe.turnoya.compartido.datos.Sql;

/** Acceso a {@code config_citas}, {@code slot}, {@code cita}, {@code cita_evento}, {@code cita_recordatorio} y bloqueos. */
@Repository
class CitasJdbc implements RepositorioCitas {

    private static final String COLUMNAS_CITA = """
            c.id, c.local_id, c.cola_id, c.slot_id, c.cliente_id, c.estado::text AS estado, c.inicio, c.fin, c.token, c.codigo_checkin, c.tarde,
            c.turno_id, c.fecha
            """;

    private final JdbcClient jdbc;

    CitasJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // --- Configuración y colas ---

    @Override
    public ConfigCitas config(int colaId) {
        return jdbc.sql("""
                        SELECT activo, duracion_slot_min, cuota_citas_pct, capacidad_fija, anticipacion_min_min, anticipacion_max_dias, checkin_antes_min,
                               checkin_despues_min, gracia_no_show_min, max_no_show, bloqueo_dias, peso_cita, recordatorios_min
                          FROM config_citas WHERE cola_id = :cola""")
                .param("cola", colaId)
                .query((rs, n) -> new ConfigCitas(rs.getBoolean("activo"), rs.getInt("duracion_slot_min"), rs.getInt("cuota_citas_pct"),
                        Sql.entero(rs, "capacidad_fija"), rs.getInt("anticipacion_min_min"), rs.getInt("anticipacion_max_dias"),
                        rs.getInt("checkin_antes_min"), rs.getInt("checkin_despues_min"), rs.getInt("gracia_no_show_min"), rs.getInt("max_no_show"),
                        rs.getInt("bloqueo_dias"), rs.getInt("peso_cita"), enteros(rs.getArray("recordatorios_min"))))
                .optional().orElse(ConfigCitas.POR_DEFECTO);
    }

    @Override
    public void guardarConfig(int colaId, ConfigCitas c) {
        jdbc.sql("""
                        INSERT INTO config_citas (cola_id, activo, duracion_slot_min, cuota_citas_pct, capacidad_fija, anticipacion_min_min, anticipacion_max_dias,
                                                  checkin_antes_min, checkin_despues_min, gracia_no_show_min, max_no_show, bloqueo_dias, peso_cita, recordatorios_min)
                        VALUES (:cola, :activo, :duracion, :cuota, :fija, :antMin, :antMax, :antes, :despues, :gracia, :maxNoShow, :bloqueo, :peso, CAST(:rec AS int[]))
                        ON CONFLICT (cola_id) DO UPDATE SET activo = EXCLUDED.activo, duracion_slot_min = EXCLUDED.duracion_slot_min,
                          cuota_citas_pct = EXCLUDED.cuota_citas_pct, capacidad_fija = EXCLUDED.capacidad_fija, anticipacion_min_min = EXCLUDED.anticipacion_min_min,
                          anticipacion_max_dias = EXCLUDED.anticipacion_max_dias, checkin_antes_min = EXCLUDED.checkin_antes_min,
                          checkin_despues_min = EXCLUDED.checkin_despues_min, gracia_no_show_min = EXCLUDED.gracia_no_show_min, max_no_show = EXCLUDED.max_no_show,
                          bloqueo_dias = EXCLUDED.bloqueo_dias, peso_cita = EXCLUDED.peso_cita, recordatorios_min = EXCLUDED.recordatorios_min""")
                .param("cola", colaId).param("activo", c.activo()).param("duracion", c.duracionSlotMin()).param("cuota", c.cuotaCitasPct())
                .param("fija", c.capacidadFija()).param("antMin", c.anticipacionMinMin()).param("antMax", c.anticipacionMaxDias())
                .param("antes", c.checkinAntesMin()).param("despues", c.checkinDespuesMin()).param("gracia", c.graciaNoShowMin())
                .param("maxNoShow", c.maxNoShow()).param("bloqueo", c.bloqueoDias()).param("peso", c.pesoCita())
                .param("rec", "{" + c.recordatoriosMin().stream().map(String::valueOf).collect(Collectors.joining(",")) + "}")
                .update();
    }

    @Override
    public int otrasColasConCitas(int localId, int exceptoColaId) {
        return jdbc.sql("SELECT COUNT(*) FROM config_citas cc JOIN cola c ON c.id = cc.cola_id WHERE cc.activo AND c.local_id = :local AND cc.cola_id <> :cola")
                .param("local", localId).param("cola", exceptoColaId).query(Integer.class).single();
    }

    @Override
    public void pesoCategoriaCita(int localId, int peso) {
        jdbc.sql("UPDATE categoria_prioridad SET peso_base = :peso WHERE local_id = :local AND codigo = 'CITA'").param("peso", peso).param("local", localId).update();
    }

    private static final String COLAS = """
            SELECT c.id, c.local_id, c.nombre, c.descripcion, c.activa, COALESCE(cc.activo, false) AS con_citas,
                   (SELECT COUNT(*) FROM ventanilla v WHERE v.cola_id = c.id AND v.activa) AS ventanillas
              FROM cola c LEFT JOIN config_citas cc ON cc.cola_id = c.id
            """;

    @Override
    public Optional<ColaCitas> cola(int localId, int colaId) {
        return jdbc.sql(COLAS + " WHERE c.id = :cola AND c.local_id = :local").param("cola", colaId).param("local", localId).query(CitasJdbc::cola).optional();
    }

    @Override
    public List<ColaCitas> colasDelLocal(int localId) {
        return jdbc.sql(COLAS + " WHERE c.local_id = :local AND c.activa ORDER BY c.orden, c.id").param("local", localId).query(CitasJdbc::cola).list();
    }

    @Override
    public List<ConfigActiva> configsActivas() {
        return jdbc.sql("SELECT cc.cola_id, c.local_id, cc.anticipacion_max_dias FROM config_citas cc JOIN cola c ON c.id = cc.cola_id WHERE cc.activo AND c.activa")
                .query((rs, n) -> new ConfigActiva(rs.getInt("cola_id"), rs.getInt("local_id"), rs.getInt("anticipacion_max_dias"))).list();
    }

    // --- Slots ---

    @Override
    public List<Tramo> horarios(int localId, int diaSemana) {
        return jdbc.sql("SELECT apertura, cierre FROM horario_local WHERE local_id = :local AND dia_semana = :dia AND activo")
                .param("local", localId).param("dia", diaSemana).query((rs, n) -> new Tramo(rs.getString("apertura"), rs.getString("cierre"))).list();
    }

    @Override
    public List<Rango> bloqueosAgenda(int localId, int colaId, Instant desde, Instant hasta) {
        return jdbc.sql("""
                        SELECT inicio, fin FROM bloqueo_agenda
                         WHERE local_id = :local AND (cola_id IS NULL OR cola_id = :cola) AND inicio < :hasta AND fin > :desde""")
                .param("local", localId).param("cola", colaId).param("desde", Sql.utc(desde)).param("hasta", Sql.utc(hasta))
                .query((rs, n) -> new Rango(Sql.instante(rs, "inicio"), Sql.instante(rs, "fin"))).list();
    }

    @Override
    public int insertarSlots(int colaId, List<Rango> franjas, int capacidad) {
        int n = 0;
        for (Rango f : franjas) {
            n += jdbc.sql("INSERT INTO slot (cola_id, inicio, fin, capacidad) VALUES (:cola, :inicio, :fin, :cap) ON CONFLICT (cola_id, inicio) DO NOTHING")
                    .param("cola", colaId).param("inicio", Sql.utc(f.inicio())).param("fin", Sql.utc(f.fin())).param("cap", capacidad).update();
        }
        return n;
    }

    @Override
    public List<Slot> slots(int localId, Integer colaId, Instant desde, Instant hasta) {
        return jdbc.sql("""
                        SELECT s.id, s.cola_id, c.nombre AS cola, s.inicio, s.fin, s.capacidad, s.reservados
                          FROM slot s JOIN cola c ON c.id = s.cola_id
                         WHERE c.local_id = :local AND (CAST(:cola AS int) IS NULL OR s.cola_id = :cola) AND s.inicio >= :desde AND s.inicio < :hasta
                         ORDER BY s.inicio, c.orden""")
                .param("local", localId).param("cola", colaId).param("desde", Sql.utc(desde)).param("hasta", Sql.utc(hasta))
                .query(CitasJdbc::slot).list();
    }

    @Override
    public Optional<Slot> slot(int slotId, int colaId) {
        return jdbc.sql("""
                        SELECT s.id, s.cola_id, c.nombre AS cola, s.inicio, s.fin, s.capacidad, s.reservados
                          FROM slot s JOIN cola c ON c.id = s.cola_id WHERE s.id = :id AND s.cola_id = :cola""")
                .param("id", slotId).param("cola", colaId).query(CitasJdbc::slot).optional();
    }

    // --- Reserva ---

    @Override
    public Optional<Instant> bloqueoVigente(int localId, int clienteId, Instant ahora) {
        return jdbc.sql("""
                        SELECT hasta FROM bloqueo_cliente WHERE local_id = :local AND cliente_id = :cliente AND hasta > :ahora AND liberado_por IS NULL
                         ORDER BY hasta DESC LIMIT 1""")
                .param("local", localId).param("cliente", clienteId).param("ahora", Sql.utc(ahora))
                .query((rs, n) -> Sql.instante(rs, "hasta")).optional();
    }

    @Override
    public int citasFuturasActivas(int clienteId, Instant ahora) {
        return jdbc.sql("SELECT COUNT(*) FROM cita WHERE cliente_id = :cliente AND estado IN ('RESERVADA', 'CONFIRMADA') AND inicio > :ahora")
                .param("cliente", clienteId).param("ahora", Sql.utc(ahora)).query(Integer.class).single();
    }

    @Override
    public Optional<Integer> reservar(int localId, int colaId, int slotId, int clienteId, String zona, String token, String codigo, String canal,
                                      Instant minInicio, Instant maxInicio) {
        return jdbc.sql("""
                        WITH cupo AS (
                          UPDATE slot s SET reservados = s.reservados + 1
                           WHERE s.id = :slot AND s.cola_id = :cola AND s.reservados < s.capacidad AND s.inicio >= :min AND s.inicio <= :max
                          RETURNING s.id, s.cola_id, s.inicio, s.fin
                        )
                        INSERT INTO cita (local_id, cola_id, slot_id, cliente_id, fecha, inicio, fin, token, codigo_checkin, canal, estado)
                        SELECT :local, c.cola_id, c.id, :cliente, ((c.inicio AT TIME ZONE 'UTC') AT TIME ZONE :zona)::date, c.inicio, c.fin, :token, :codigo,
                               CAST(:canal AS "CanalCita"), 'RESERVADA'
                          FROM cupo c
                        RETURNING id""")
                .param("slot", slotId).param("cola", colaId).param("min", Sql.utc(minInicio)).param("max", Sql.utc(maxInicio)).param("local", localId)
                .param("cliente", clienteId).param("zona", zona).param("token", token).param("codigo", codigo).param("canal", canal)
                .query(Integer.class).optional();
    }

    @Override
    public void evento(int citaId, String tipo, String datosJson, String actor) {
        jdbc.sql("INSERT INTO cita_evento (cita_id, tipo, datos, actor) VALUES (:cita, :tipo, CAST(:datos AS jsonb), :actor)")
                .param("cita", citaId).param("tipo", tipo).param("datos", datosJson).param("actor", actor).update();
    }

    @Override
    public Optional<Cita> cita(int citaId) {
        return jdbc.sql("SELECT " + COLUMNAS_CITA + " FROM cita c WHERE c.id = :id").param("id", citaId).query(CitasJdbc::cita).optional();
    }

    @Override
    public Optional<Cita> citaPorToken(String token) {
        return jdbc.sql("SELECT " + COLUMNAS_CITA + " FROM cita c WHERE c.token = :token").param("token", token).query(CitasJdbc::cita).optional();
    }

    @Override
    public Optional<Cita> citaPorCodigo(int localId, String codigo) {
        return jdbc.sql("SELECT " + COLUMNAS_CITA + " FROM cita c WHERE c.local_id = :local AND c.codigo_checkin = :codigo ORDER BY c.inicio DESC LIMIT 1")
                .param("local", localId).param("codigo", codigo).query(CitasJdbc::cita).optional();
    }

    @Override
    public Optional<TurnoDeCita> turno(int turnoId) {
        return jdbc.sql("SELECT token, codigo, estado::text AS estado FROM turno WHERE id = :id").param("id", turnoId)
                .query((rs, n) -> new TurnoDeCita(rs.getString("token"), rs.getString("codigo"), rs.getString("estado"))).optional();
    }

    @Override
    public Optional<Contacto> contacto(int clienteId) {
        return jdbc.sql("SELECT nombre, telefono_cifrado FROM cliente WHERE id = :id").param("id", clienteId)
                .query((rs, n) -> new Contacto(rs.getString("nombre"), rs.getString("telefono_cifrado"))).optional();
    }

    @Override
    public boolean cambiarEstado(int citaId, Set<EstadoCita> desde, EstadoCita hacia, Instant confirmadaAt) {
        return jdbc.sql("""
                        UPDATE cita SET estado = CAST(:hacia AS "EstadoCita"), confirmada_at = COALESCE(:confirmada, confirmada_at)
                         WHERE id = :id AND estado::text IN (:desde)""")
                .param("hacia", hacia.name()).param("confirmada", Sql.utc(confirmadaAt)).param("id", citaId)
                .param("desde", desde.stream().map(Enum::name).toList())
                .update() > 0;
    }

    @Override
    @Transactional
    public boolean cancelar(int citaId, String motivo, Instant ahora) {
        Optional<Integer> slot = jdbc.sql("""
                        UPDATE cita SET estado = 'CANCELADA', cancelada_at = :ahora, motivo_cancelacion = :motivo
                         WHERE id = :id AND estado IN ('RESERVADA', 'CONFIRMADA') RETURNING slot_id""")
                .param("ahora", Sql.utc(ahora)).param("motivo", motivo).param("id", citaId).query(Integer.class).optional();
        slot.ifPresent(s -> jdbc.sql("UPDATE slot SET reservados = reservados - 1 WHERE id = :id AND reservados > 0").param("id", s).update());
        return slot.isPresent();
    }

    @Override
    @Transactional
    public boolean reprogramar(Cita c, int nuevoSlotId, Instant minInicio, Instant maxInicio, String zona) {
        // Orden fijo de bloqueo ⇒ sin deadlocks entre reprogramaciones cruzadas
        jdbc.sql("SELECT id FROM slot WHERE id IN (:a, :b) ORDER BY id FOR UPDATE").param("a", c.slotId()).param("b", nuevoSlotId).query(Integer.class).list();
        int tomado = jdbc.sql("""
                        UPDATE slot SET reservados = reservados + 1
                         WHERE id = :id AND cola_id = :cola AND reservados < capacidad AND inicio >= :min AND inicio <= :max""")
                .param("id", nuevoSlotId).param("cola", c.colaId()).param("min", Sql.utc(minInicio)).param("max", Sql.utc(maxInicio)).update();
        if (tomado == 0) {
            return false;
        }
        jdbc.sql("UPDATE slot SET reservados = reservados - 1 WHERE id = :id AND reservados > 0").param("id", c.slotId()).update();
        jdbc.sql("""
                        UPDATE cita c SET slot_id = s.id, inicio = s.inicio, fin = s.fin, fecha = ((s.inicio AT TIME ZONE 'UTC') AT TIME ZONE :zona)::date,
                                          estado = 'RESERVADA', confirmada_at = NULL
                          FROM slot s WHERE s.id = :slot AND c.id = :cita""")
                .param("zona", zona).param("slot", nuevoSlotId).param("cita", c.id()).update();
        return true;
    }

    @Override
    public void borrarRecordatorios(int citaId) {
        jdbc.sql("DELETE FROM cita_recordatorio WHERE cita_id = :id").param("id", citaId).update();
    }

    @Override
    public void marcarCheckin(int citaId, int turnoId, Instant ahora, boolean tarde) {
        jdbc.sql("UPDATE cita SET estado = 'CHECKIN', turno_id = :turno, checkin_at = :ahora, tarde = :tarde WHERE id = :id")
                .param("turno", turnoId).param("ahora", Sql.utc(ahora)).param("tarde", tarde).param("id", citaId).update();
    }

    @Override
    public void marcarEstado(int citaId, EstadoCita estado) {
        jdbc.sql("UPDATE cita SET estado = CAST(:e AS \"EstadoCita\") WHERE id = :id").param("e", estado.name()).param("id", citaId).update();
    }

    @Override
    public int noShowsDesde(int localId, int clienteId, Instant desde) {
        return jdbc.sql("SELECT COUNT(*) FROM cita WHERE local_id = :local AND cliente_id = :cliente AND estado = 'NO_SHOW' AND inicio >= :desde")
                .param("local", localId).param("cliente", clienteId).param("desde", Sql.utc(desde)).query(Integer.class).single();
    }

    @Override
    public boolean hayBloqueoVigente(int localId, int clienteId, Instant ahora) {
        return bloqueoVigente(localId, clienteId, ahora).isPresent();
    }

    @Override
    public void crearBloqueoCliente(int localId, int clienteId, Instant hasta, String motivo) {
        jdbc.sql("INSERT INTO bloqueo_cliente (local_id, cliente_id, hasta, motivo) VALUES (:local, :cliente, :hasta, :motivo)")
                .param("local", localId).param("cliente", clienteId).param("hasta", Sql.utc(hasta)).param("motivo", motivo).update();
    }

    // --- Jobs ---

    @Override
    public List<CitaParaRecordar> paraRecordar(Instant ahora, Instant hasta) {
        return jdbc.sql("""
                        SELECT c.id, c.local_id, c.inicio, COALESCE(cc.recordatorios_min, ARRAY[1440, 120]) AS recordatorios_min
                          FROM cita c LEFT JOIN config_citas cc ON cc.cola_id = c.cola_id
                         WHERE c.estado IN ('RESERVADA', 'CONFIRMADA') AND c.inicio > :ahora AND c.inicio < :hasta""")
                .param("ahora", Sql.utc(ahora)).param("hasta", Sql.utc(hasta))
                .query((rs, n) -> new CitaParaRecordar(rs.getInt("id"), rs.getInt("local_id"), Sql.instante(rs, "inicio"), enteros(rs.getArray("recordatorios_min"))))
                .list();
    }

    @Override
    public boolean registrarRecordatorio(int citaId, String tipo) {
        return jdbc.sql("INSERT INTO cita_recordatorio (cita_id, tipo) VALUES (:cita, :tipo) ON CONFLICT DO NOTHING").param("cita", citaId).param("tipo", tipo)
                .update() > 0;
    }

    @Override
    public List<Cita> marcarNoShowVencidas(Instant ahora) {
        return jdbc.sql("""
                        UPDATE cita c SET estado = 'NO_SHOW'
                          FROM config_citas cfg
                         WHERE cfg.cola_id = c.cola_id AND c.estado IN ('RESERVADA', 'CONFIRMADA')
                           AND c.inicio + make_interval(mins => cfg.checkin_despues_min + cfg.gracia_no_show_min) < :ahora
                        RETURNING""" + " " + COLUMNAS_CITA)
                .param("ahora", Sql.utc(ahora)).query(CitasJdbc::cita).list();
    }

    // --- Administración ---

    private static final String AGENDA = """
            SELECT c.id, c.token, c.inicio, c.estado::text AS estado, c.canal::text AS canal, c.cola_id, co.nombre AS cola, cl.nombre, cl.telefono_cifrado,
                   c.codigo_checkin, t.codigo AS turno_codigo, t.estado::text AS turno_estado, c.tarde
              FROM cita c JOIN cola co ON co.id = c.cola_id JOIN cliente cl ON cl.id = c.cliente_id LEFT JOIN turno t ON t.id = c.turno_id
            """;

    @Override
    public List<CitaAgenda> agenda(int localId, LocalDate fecha, Integer colaId) {
        return jdbc.sql(AGENDA + " WHERE c.local_id = :local AND c.fecha = :fecha AND (CAST(:cola AS int) IS NULL OR c.cola_id = :cola) ORDER BY c.inicio, c.id")
                .param("local", localId).param("fecha", fecha).param("cola", colaId).query(CitasJdbc::agenda).list();
    }

    @Override
    public List<CitaAgenda> proximas(int localId, Instant desde, Instant hasta, int limite) {
        return jdbc.sql(AGENDA + """
                         WHERE c.local_id = :local AND c.estado IN ('RESERVADA', 'CONFIRMADA') AND c.inicio >= :desde AND c.inicio <= :hasta
                         ORDER BY c.inicio LIMIT :limite""")
                .param("local", localId).param("desde", Sql.utc(desde)).param("hasta", Sql.utc(hasta)).param("limite", limite)
                .query(CitasJdbc::agenda).list();
    }

    @Override
    public List<BloqueoAgenda> bloqueosAgendaVigentes(int localId, Instant ahora) {
        return jdbc.sql("""
                        SELECT b.id, b.cola_id, c.nombre AS cola, b.inicio, b.fin, b.motivo FROM bloqueo_agenda b LEFT JOIN cola c ON c.id = b.cola_id
                         WHERE b.local_id = :local AND b.fin > :ahora ORDER BY b.inicio""")
                .param("local", localId).param("ahora", Sql.utc(ahora))
                .query((rs, n) -> new BloqueoAgenda(rs.getInt("id"), Sql.entero(rs, "cola_id"), rs.getString("cola"), Sql.instante(rs, "inicio"),
                        Sql.instante(rs, "fin"), rs.getString("motivo")))
                .list();
    }

    @Override
    public List<BloqueoCliente> bloqueosClienteVigentes(int localId, Instant ahora) {
        return jdbc.sql("""
                        SELECT b.id, b.cliente_id, cl.nombre, b.hasta, b.motivo FROM bloqueo_cliente b JOIN cliente cl ON cl.id = b.cliente_id
                         WHERE b.local_id = :local AND b.hasta > :ahora AND b.liberado_por IS NULL ORDER BY b.hasta""")
                .param("local", localId).param("ahora", Sql.utc(ahora))
                .query((rs, n) -> new BloqueoCliente(rs.getInt("id"), rs.getInt("cliente_id"), rs.getString("nombre"), Sql.instante(rs, "hasta"),
                        rs.getString("motivo")))
                .list();
    }

    @Override
    public int crearBloqueoAgenda(int localId, Integer colaId, Instant inicio, Instant fin, String motivo) {
        return jdbc.sql("INSERT INTO bloqueo_agenda (local_id, cola_id, inicio, fin, motivo) VALUES (:local, :cola, :inicio, :fin, :motivo) RETURNING id")
                .param("local", localId).param("cola", colaId).param("inicio", Sql.utc(inicio)).param("fin", Sql.utc(fin)).param("motivo", motivo)
                .query(Integer.class).single();
    }

    @Override
    public int borrarSlotsLibres(int localId, Integer colaId, Instant inicio, Instant fin) {
        return jdbc.sql("""
                        DELETE FROM slot s USING cola c
                         WHERE c.id = s.cola_id AND c.local_id = :local AND (CAST(:cola AS int) IS NULL OR s.cola_id = :cola)
                           AND s.reservados = 0 AND s.inicio < :fin AND s.fin > :inicio""")
                .param("local", localId).param("cola", colaId).param("inicio", Sql.utc(inicio)).param("fin", Sql.utc(fin)).update();
    }

    @Override
    public boolean eliminarBloqueoAgenda(int localId, int id) {
        return jdbc.sql("DELETE FROM bloqueo_agenda WHERE id = :id AND local_id = :local").param("id", id).param("local", localId).update() > 0;
    }

    @Override
    public boolean liberarCliente(int localId, int id, int usuarioId) {
        return jdbc.sql("UPDATE bloqueo_cliente SET liberado_por = :usuario WHERE id = :id AND local_id = :local AND liberado_por IS NULL")
                .param("usuario", usuarioId).param("id", id).param("local", localId).update() > 0;
    }

    // --- Mapeos ---

    private static ColaCitas cola(ResultSet rs, int n) throws SQLException {
        return new ColaCitas(rs.getInt("id"), rs.getInt("local_id"), rs.getString("nombre"), rs.getBoolean("activa"), rs.getInt("ventanillas"),
                rs.getBoolean("con_citas"), rs.getString("descripcion"));
    }

    private static Slot slot(ResultSet rs, int n) throws SQLException {
        return new Slot(rs.getInt("id"), rs.getInt("cola_id"), rs.getString("cola"), Sql.instante(rs, "inicio"), Sql.instante(rs, "fin"),
                rs.getInt("capacidad"), rs.getInt("reservados"));
    }

    private static Cita cita(ResultSet rs, int n) throws SQLException {
        return new Cita(rs.getInt("id"), rs.getInt("local_id"), rs.getInt("cola_id"), rs.getInt("slot_id"), rs.getInt("cliente_id"),
                EstadoCita.valueOf(rs.getString("estado")), Sql.instante(rs, "inicio"), Sql.instante(rs, "fin"), rs.getString("token"),
                rs.getString("codigo_checkin"), rs.getBoolean("tarde"), Sql.entero(rs, "turno_id"), Sql.fecha(rs, "fecha"));
    }

    private static CitaAgenda agenda(ResultSet rs, int n) throws SQLException {
        return new CitaAgenda(rs.getInt("id"), rs.getString("token"), Sql.instante(rs, "inicio"), EstadoCita.valueOf(rs.getString("estado")),
                rs.getString("canal"), rs.getInt("cola_id"), rs.getString("cola"), rs.getString("nombre"), rs.getString("telefono_cifrado"),
                rs.getString("codigo_checkin"), rs.getString("turno_codigo"), rs.getString("turno_estado"), rs.getBoolean("tarde"));
    }

    private static List<Integer> enteros(Array a) throws SQLException {
        if (a == null) {
            return List.of();
        }
        Object[] xs = (Object[]) a.getArray();
        return Arrays.stream(xs).map(x -> ((Number) x).intValue()).toList();
    }
}
