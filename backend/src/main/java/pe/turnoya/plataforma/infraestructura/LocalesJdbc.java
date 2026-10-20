package pe.turnoya.plataforma.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.plataforma.Local;
import pe.turnoya.plataforma.Plan;

/** Acceso a las tablas {@code local} y {@code plan}. */
@Repository
public class LocalesJdbc {

    private static final String COLUMNAS_LOCAL = """
            id, slug, razon_social, nombre_comercial, rubro, direccion, ciudad, telefono, plan_id, zona_horaria, activo,
            color_primario, logo_url, mensaje_tv, mensaje_bienvenida, avisar_faltando, tiempo_ausencia_seg, plan_vence_at""";

    private final JdbcClient jdbc;

    public LocalesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Local> porSlug(String slug) {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE slug = :slug")
                .param("slug", slug).query(LocalesJdbc::local).optional();
    }

    public Optional<Local> porId(int id) {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE id = :id")
                .param("id", id).query(LocalesJdbc::local).optional();
    }

    public List<Local> activos() {
        return jdbc.sql("SELECT " + COLUMNAS_LOCAL + " FROM local WHERE activo ORDER BY id")
                .query(LocalesJdbc::local).list();
    }

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
