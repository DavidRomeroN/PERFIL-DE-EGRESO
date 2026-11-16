package pe.turnoya.plataforma.infraestructura;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.dominio.RepositorioPlanes;

/** Acceso a {@code plan} y {@code plan_modulo}. */
@Repository
class PlanesJdbc implements RepositorioPlanes {

    private static final String CONSULTA = """
            SELECT p.id, p.codigo, p.nombre, p.precio_mensual, p.max_turnos_mes, p.max_colas, p.max_ventanillas, p.whatsapp_habilitado,
                   p.max_avisos_whatsapp, p.reportes, p.descripcion,
                   COALESCE((SELECT string_agg(pm.modulo::text, ',' ORDER BY pm.modulo) FROM plan_modulo pm WHERE pm.plan_id = p.id), '') AS modulos,
                   (SELECT count(*) FROM local l WHERE l.plan_id = p.id) AS locales
              FROM plan p""";

    private final JdbcClient jdbc;

    PlanesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<PlanFila> todos() {
        return jdbc.sql(CONSULTA + " ORDER BY p.precio_mensual, p.id").query(PlanesJdbc::fila).list();
    }

    @Override
    public Optional<PlanFila> porId(int id) {
        return jdbc.sql(CONSULTA + " WHERE p.id = :id").param("id", id).query(PlanesJdbc::fila).optional();
    }

    @Override
    public boolean existeCodigo(String codigo, Integer excepto) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM plan WHERE codigo = :codigo AND (CAST(:excepto AS int) IS NULL OR id <> :excepto))")
                .param("codigo", codigo).param("excepto", excepto)
                .query(Boolean.class).single();
    }

    @Override
    public int crear(DatosPlan d) {
        int id = jdbc.sql("""
                        INSERT INTO plan (codigo, nombre, precio_mensual, max_turnos_mes, max_colas, max_ventanillas, whatsapp_habilitado,
                                          max_avisos_whatsapp, reportes, descripcion)
                        VALUES (:codigo, :nombre, :precio, :turnos, :colas, :ventanillas, :wa, :avisos, :reportes, :descripcion)
                        RETURNING id""")
                .param("codigo", d.codigo()).param("nombre", d.nombre()).param("precio", d.precioMensual())
                .param("turnos", d.maxTurnosMes()).param("colas", d.maxColas()).param("ventanillas", d.maxVentanillas())
                .param("wa", d.whatsappHabilitado()).param("avisos", d.maxAvisosWhatsapp()).param("reportes", d.reportes())
                .param("descripcion", d.descripcion())
                .query(Integer.class).single();
        guardarModulos(id, d.modulos());
        return id;
    }

    @Override
    public void editar(int id, DatosPlan d) {
        jdbc.sql("""
                        UPDATE plan SET codigo = :codigo, nombre = :nombre, precio_mensual = :precio, max_turnos_mes = :turnos, max_colas = :colas,
                                        max_ventanillas = :ventanillas, whatsapp_habilitado = :wa, max_avisos_whatsapp = :avisos,
                                        reportes = :reportes, descripcion = :descripcion
                         WHERE id = :id""")
                .param("codigo", d.codigo()).param("nombre", d.nombre()).param("precio", d.precioMensual())
                .param("turnos", d.maxTurnosMes()).param("colas", d.maxColas()).param("ventanillas", d.maxVentanillas())
                .param("wa", d.whatsappHabilitado()).param("avisos", d.maxAvisosWhatsapp()).param("reportes", d.reportes())
                .param("descripcion", d.descripcion()).param("id", id)
                .update();
        jdbc.sql("DELETE FROM plan_modulo WHERE plan_id = :id").param("id", id).update();
        guardarModulos(id, d.modulos());
    }

    @Override
    public int localesCon(int id) {
        return jdbc.sql("SELECT count(*) FROM local WHERE plan_id = :id").param("id", id).query(Integer.class).single();
    }

    @Override
    public void eliminar(int id) {
        jdbc.sql("DELETE FROM plan WHERE id = :id").param("id", id).update();
    }

    private void guardarModulos(int planId, Set<Modulo> modulos) {
        for (Modulo m : modulos) {
            jdbc.sql("INSERT INTO plan_modulo (plan_id, modulo) VALUES (:plan, CAST(:modulo AS \"ModuloCodigo\")) ON CONFLICT DO NOTHING")
                    .param("plan", planId).param("modulo", m.name())
                    .update();
        }
    }

    private static PlanFila fila(ResultSet rs, int i) throws SQLException {
        Set<Modulo> modulos = EnumSet.noneOf(Modulo.class);
        for (String m : rs.getString("modulos").split(",")) {
            if (!m.isBlank()) {
                modulos.add(Modulo.valueOf(m));
            }
        }
        return new PlanFila(rs.getInt("id"), rs.getString("codigo"), rs.getString("nombre"), rs.getBigDecimal("precio_mensual"),
                rs.getInt("max_turnos_mes"), rs.getInt("max_colas"), rs.getInt("max_ventanillas"), rs.getBoolean("whatsapp_habilitado"),
                rs.getInt("max_avisos_whatsapp"), rs.getBoolean("reportes"), rs.getString("descripcion"), modulos, rs.getInt("locales"));
    }
}
