package pe.turnoya.plataforma.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;
import pe.turnoya.plataforma.dominio.RepositorioLocales;

/** Acceso a las tablas {@code local} y {@code plan}. */
@Repository
class LocalesJdbc implements RepositorioLocales {

    private static final String COLUMNAS_LOCAL = """
            id, slug, razon_social, nombre_comercial, rubro, direccion, ciudad, telefono, plan_id, zona_horaria, activo,
            color_primario, logo_url, mensaje_tv, mensaje_bienvenida, avisar_faltando, tiempo_ausencia_seg, plan_vence_at""";

    private final JdbcClient jdbc;

    LocalesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Local> porSlug(String slug) {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE slug = :slug")
                .param("slug", slug).query(LocalesJdbc::local).optional();
    }

    @Override
    public Optional<Local> porId(int id) {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE id = :id")
                .param("id", id).query(LocalesJdbc::local).optional();
    }

    @Override
    public List<Local> activos() {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE activo ORDER BY id")
                .query(LocalesJdbc::local).list();
    }

    @Override
    public Plan plan(int planId) {
        return jdbc.sql("""
                        SELECT id, codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas,
                               whatsapp_habilitado, max_avisos_whatsapp, reportes
                          FROM plan WHERE id = :id""")
                .param("id", planId)
                .query((rs, i) -> new Plan(rs.getInt("id"), rs.getString("codigo"), rs.getString("nombre"),
                        rs.getBigDecimal("precio_mensual"), rs.getInt("max_turnos_mes"), rs.getInt("max_colas"),
                        rs.getInt("max_ventanillas"), rs.getBoolean("whatsapp_habilitado"),
                        rs.getInt("max_avisos_whatsapp"), rs.getBoolean("reportes")))
                .single();
    }

    @Override
    public String ruc(int id) {
        return jdbc.sql("SELECT ruc FROM local WHERE id = :id").param("id", id).query(String.class).optional().orElse(null);
    }

    @Override
    public void actualizarNegocio(int id, DatosNegocio d) {
        jdbc.sql("""
                        UPDATE local SET nombre_comercial = :nc, razon_social = :rs, ruc = :ruc, rubro = :rubro, direccion = :dir,
                                         telefono = :tel WHERE id = :id""")
                .param("nc", d.nombreComercial()).param("rs", d.razonSocial()).param("ruc", d.ruc()).param("rubro", d.rubro())
                .param("dir", d.direccion()).param("tel", d.telefono()).param("id", id)
                .update();
    }

    @Override
    public void actualizarPantalla(int id, DatosPantalla d) {
        jdbc.sql("""
                        UPDATE local SET color_primario = :color, logo_url = :logo, mensaje_tv = :tv, mensaje_bienvenida = :bienvenida,
                                         avisar_faltando = :faltando WHERE id = :id""")
                .param("color", d.colorPrimario()).param("logo", d.logoUrl()).param("tv", d.mensajeTv())
                .param("bienvenida", d.mensajeBienvenida()).param("faltando", d.avisarFaltando()).param("id", id)
                .update();
    }

    @Override
    public void actualizarAusencia(int id, Integer segundos) {
        jdbc.sql("UPDATE local SET tiempo_ausencia_seg = :seg WHERE id = :id").param("seg", segundos).param("id", id).update();
    }

    @Override
    public UsoLocal uso(int id, Instant desde) {
        return jdbc.sql("""
                        SELECT (SELECT count(*) FROM turno WHERE local_id = :id AND emitido_at >= :desde) AS turnos,
                               (SELECT count(*) FROM notificacion n JOIN turno t ON t.id = n.turno_id
                                 WHERE t.local_id = :id AND n.tipo = 'WHATSAPP' AND n.created_at >= :desde) AS avisos,
                               (SELECT count(*) FROM cola WHERE local_id = :id) AS colas,
                               (SELECT count(*) FROM ventanilla WHERE local_id = :id) AS ventanillas,
                               (SELECT count(*) FROM usuario WHERE local_id = :id) AS usuarios""")
                .param("id", id).param("desde", Sql.utc(desde))
                .query((rs, i) -> new UsoLocal(rs.getInt("turnos"), rs.getInt("avisos"), rs.getInt("colas"), rs.getInt("ventanillas"),
                        rs.getInt("usuarios")))
                .single();
    }

    @Override
    public List<LocalResumen> todosConUso(Instant inicioMes) {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL.replaceFirst("id,", "l.id,") + """
                        , l.ruc, p.nombre AS plan_nombre,
                               (SELECT count(*) FROM cola c WHERE c.local_id = l.id) AS n_colas,
                               (SELECT count(*) FROM ventanilla v WHERE v.local_id = l.id) AS n_ventanillas,
                               (SELECT count(*) FROM usuario u WHERE u.local_id = l.id) AS n_usuarios,
                               (SELECT count(*) FROM turno t WHERE t.local_id = l.id AND t.emitido_at >= :desde) AS n_turnos
                          FROM local l JOIN plan p ON p.id = l.plan_id ORDER BY l.id""")
                .param("desde", Sql.utc(inicioMes))
                .query((rs, i) -> new LocalResumen(local(rs, i), rs.getString("ruc"), rs.getString("plan_nombre"), rs.getInt("n_colas"), rs.getInt("n_ventanillas"),
                        rs.getInt("n_usuarios"), rs.getInt("n_turnos")))
                .list();
    }

    @Override
    public long turnosRegistrados() {
        return jdbc.sql("SELECT count(*) FROM turno").query(Long.class).single();
    }

    @Override
    public boolean existeSlug(String slug) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM local WHERE slug = :slug)").param("slug", slug).query(Boolean.class).single();
    }

    @Override
    public int crear(AltaLocal a) {
        return jdbc.sql("""
                        INSERT INTO local (slug, nombre_comercial, razon_social, ruc, rubro, direccion, telefono, ciudad, plan_id, color_primario,
                                           plan_vence_at, mensaje_bienvenida, mensaje_tv)
                        VALUES (:slug, :nc, :rs, :ruc, :rubro, :dir, :tel, :ciudad, :plan, :color, :vence,
                                'Toma tu turno y espera donde quieras: te avisamos cuando falte poco.', 'Bienvenido. Por favor espere su llamado.')
                        RETURNING id""")
                .param("slug", a.slug()).param("nc", a.nombreComercial()).param("rs", a.razonSocial()).param("ruc", a.ruc())
                .param("rubro", a.rubro()).param("dir", a.direccion()).param("tel", a.telefono()).param("ciudad", a.ciudad())
                .param("plan", a.planId()).param("color", a.colorPrimario()).param("vence", Sql.utc(a.planVenceAt()))
                .query(Integer.class).single();
    }

    @Override
    public void editar(int id, AltaLocal a) {
        jdbc.sql("""
                        UPDATE local SET slug = :slug, nombre_comercial = :nc, razon_social = :rs, ruc = :ruc, rubro = :rubro, direccion = :dir,
                                         telefono = :tel, ciudad = :ciudad, plan_id = :plan, color_primario = :color WHERE id = :id""")
                .param("slug", a.slug()).param("nc", a.nombreComercial()).param("rs", a.razonSocial()).param("ruc", a.ruc())
                .param("rubro", a.rubro()).param("dir", a.direccion()).param("tel", a.telefono()).param("ciudad", a.ciudad())
                .param("plan", a.planId()).param("color", a.colorPrimario()).param("id", id)
                .update();
    }

    @Override
    public void activar(int id, boolean activo) {
        jdbc.sql("UPDATE local SET activo = :activo WHERE id = :id").param("activo", activo).param("id", id).update();
    }

    private static Local local(ResultSet rs, int fila) throws SQLException {
        return new Local(
                rs.getInt("id"),
                rs.getString("slug"),
                rs.getString("razon_social"),
                rs.getString("nombre_comercial"),
                rs.getString("rubro"),
                rs.getString("direccion"),
                rs.getString("ciudad"),
                rs.getString("telefono"),
                rs.getInt("plan_id"),
                Fechas.zona(rs.getString("zona_horaria")),
                rs.getBoolean("activo"),
                rs.getString("color_primario"),
                rs.getString("logo_url"),
                rs.getString("mensaje_tv"),
                rs.getString("mensaje_bienvenida"),
                rs.getInt("avisar_faltando"),
                Sql.entero(rs, "tiempo_ausencia_seg"),
                Sql.instante(rs, "plan_vence_at"));
    }
}
