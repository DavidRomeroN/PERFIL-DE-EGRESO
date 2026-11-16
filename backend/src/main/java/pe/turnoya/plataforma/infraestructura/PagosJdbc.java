package pe.turnoya.plataforma.infraestructura;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.compartido.datos.Sql;
import pe.turnoya.plataforma.dominio.RepositorioPagos;

/** Acceso a las tablas {@code pago}, {@code plan} y {@code plan_modulo}. */
@Repository
class PagosJdbc implements RepositorioPagos {

    private static final String COLUMNAS_PAGO = """
            p.id, p.local_id, p.plan_id, pl.nombre AS plan, p.estado::text AS estado, p.estado_detalle, p.monto, p.meses, p.metodo,
            p.ultimos4, p.registro::text AS registro, p.creado_at
            FROM pago p JOIN plan pl ON pl.id = p.plan_id""";

    private final JdbcClient jdbc;

    PagosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<PlanVenta> planes() {
        return jdbc.sql(SQL_PLANES + " GROUP BY p.id ORDER BY p.precio_mensual").query(PagosJdbc::plan).list();
    }

    @Override
    public Optional<PlanVenta> planPorCodigo(String codigo) {
        return jdbc.sql(SQL_PLANES + " WHERE p.codigo = :codigo GROUP BY p.id").param("codigo", codigo).query(PagosJdbc::plan).optional();
    }

    private static final String SQL_PLANES = """
            SELECT p.id, p.codigo, p.nombre, p.precio_mensual, p.descripcion,
                   COALESCE(string_agg(pm.modulo::text, ',' ORDER BY pm.modulo), '') AS modulos
            FROM plan p LEFT JOIN plan_modulo pm ON pm.plan_id = p.id""";

    @Override
    public Optional<Pago> porClaveIdem(String claveIdem) {
        return jdbc.sql("SELECT " + COLUMNAS_PAGO + " WHERE p.clave_idem = :clave").param("clave", claveIdem).query(PagosJdbc::pago).optional();
    }

    @Override
    public Optional<Pago> porId(int id) {
        return jdbc.sql("SELECT " + COLUMNAS_PAGO + " WHERE p.id = :id").param("id", id).query(PagosJdbc::pago).optional();
    }

    @Override
    public Optional<Pago> porIdProveedor(String idProveedor) {
        return jdbc.sql("SELECT " + COLUMNAS_PAGO + " WHERE p.proveedor_pago_id = :prov").param("prov", idProveedor).query(PagosJdbc::pago).optional();
    }

    @Override
    public int crear(Integer localId, int planId, String claveIdem, BigDecimal monto, int meses, String emailPagador, String registroJson) {
        return jdbc.sql("""
                        INSERT INTO pago (local_id, plan_id, clave_idem, monto, meses, email_pagador, registro)
                        VALUES (:local, :plan, :clave, :monto, :meses, :email, CAST(:registro AS jsonb)) RETURNING id""")
                .param("local", localId).param("plan", planId).param("clave", claveIdem).param("monto", monto).param("meses", meses)
                .param("email", emailPagador).param("registro", registroJson)
                .query(Integer.class).single();
    }

    @Override
    public void registrarResultado(int id, String idProveedor, String estado, String detalle, String metodo, String ultimos4, boolean borrarRegistro) {
        jdbc.sql("""
                        UPDATE pago SET proveedor_pago_id = COALESCE(:prov, proveedor_pago_id), estado = CAST(:estado AS "EstadoPago"),
                               estado_detalle = :detalle, metodo = COALESCE(:metodo, metodo), ultimos4 = COALESCE(:ultimos4, ultimos4),
                               registro = CASE WHEN :borrar THEN NULL ELSE registro END, actualizado_at = now()
                         WHERE id = :id""")
                .param("prov", idProveedor).param("estado", estado).param("detalle", detalle).param("metodo", metodo)
                .param("ultimos4", ultimos4).param("borrar", borrarRegistro).param("id", id)
                .update();
    }

    @Override
    public Optional<Pago> bloquearParaAplicar(int id) {
        List<Integer> filas = jdbc.sql("SELECT id FROM pago WHERE id = :id AND estado = 'APROBADO' AND aplicado_at IS NULL FOR UPDATE")
                .param("id", id).query(Integer.class).list();
        return filas.isEmpty() ? Optional.empty() : porId(id);
    }

    @Override
    public void marcarAplicado(int id, int localId) {
        jdbc.sql("""
                        UPDATE pago SET local_id = :local, aplicado_at = now(), actualizado_at = now(),
                               registro = CASE WHEN registro IS NULL THEN NULL ELSE '{"aplicado": true}'::jsonb END
                         WHERE id = :id""")
                .param("local", localId).param("id", id).update();
    }

    @Override
    public void extenderPlan(int localId, int planId, Instant venceAt) {
        jdbc.sql("UPDATE local SET plan_id = :plan, plan_vence_at = :vence WHERE id = :local")
                .param("plan", planId).param("vence", Sql.utc(venceAt)).param("local", localId).update();
        jdbc.sql("""
                        INSERT INTO local_modulo (local_id, modulo, habilitado)
                        SELECT :local, modulo, true FROM plan_modulo WHERE plan_id = :plan
                        ON CONFLICT (local_id, modulo) DO NOTHING""")
                .param("local", localId).param("plan", planId).update();
    }

    @Override
    public List<Pago> historial(int localId, int limite) {
        return jdbc.sql("SELECT " + COLUMNAS_PAGO + " WHERE p.local_id = :local ORDER BY p.creado_at DESC LIMIT :limite")
                .param("local", localId).param("limite", limite).query(PagosJdbc::pago).list();
    }

    private static PlanVenta plan(ResultSet rs, int i) throws SQLException {
        String modulos = rs.getString("modulos");
        return new PlanVenta(rs.getInt("id"), rs.getString("codigo"), rs.getString("nombre"), rs.getBigDecimal("precio_mensual"),
                rs.getString("descripcion"), modulos.isEmpty() ? List.of() : Arrays.asList(modulos.split(",")));
    }

    private static Pago pago(ResultSet rs, int i) throws SQLException {
        return new Pago(rs.getInt("id"), Sql.entero(rs, "local_id"), rs.getInt("plan_id"), rs.getString("plan"), rs.getString("estado"),
                rs.getString("estado_detalle"), rs.getBigDecimal("monto"), rs.getInt("meses"), rs.getString("metodo"), rs.getString("ultimos4"),
                rs.getString("registro"), Sql.instante(rs, "creado_at"));
    }
}
