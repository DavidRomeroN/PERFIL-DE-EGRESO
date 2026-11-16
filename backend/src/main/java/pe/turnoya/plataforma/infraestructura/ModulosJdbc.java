package pe.turnoya.plataforma.infraestructura;

import java.util.EnumSet;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.dominio.RepositorioModulos;

/** Acceso a {@code local_modulo} y {@code plan_modulo}. */
@Repository
class ModulosJdbc implements RepositorioModulos {

    private final JdbcClient jdbc;

    ModulosJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Set<Modulo> activos(int localId) {
        Set<Modulo> activos = EnumSet.noneOf(Modulo.class);
        jdbc.sql("""
                        SELECT lm.modulo::text AS modulo
                          FROM local_modulo lm
                          JOIN local l ON l.id = lm.local_id
                          JOIN plan_modulo pm ON pm.plan_id = l.plan_id AND pm.modulo = lm.modulo
                         WHERE lm.local_id = :local AND lm.habilitado""")
                .param("local", localId)
                .query(String.class)
                .list()
                .forEach(m -> activos.add(Modulo.valueOf(m)));
        return activos;
    }

    @Override
    public Set<Modulo> incluidos(int localId) {
        return conjunto("SELECT pm.modulo::text FROM plan_modulo pm JOIN local l ON l.plan_id = pm.plan_id WHERE l.id = :local", localId);
    }

    @Override
    public Set<Modulo> encendidos(int localId) {
        return conjunto("SELECT modulo::text FROM local_modulo WHERE local_id = :local AND habilitado", localId);
    }

    @Override
    public void cambiar(int localId, Modulo modulo, boolean habilitado) {
        jdbc.sql("""
                        INSERT INTO local_modulo (local_id, modulo, habilitado) VALUES (:local, CAST(:modulo AS "ModuloCodigo"), :habilitado)
                        ON CONFLICT (local_id, modulo) DO UPDATE SET habilitado = EXCLUDED.habilitado, actualizado_at = now()""")
                .param("local", localId).param("modulo", modulo.name()).param("habilitado", habilitado)
                .update();
    }

    @Override
    public void encenderDelPlan(int localId) {
        jdbc.sql("""
                        INSERT INTO local_modulo (local_id, modulo, habilitado)
                        SELECT l.id, pm.modulo, true FROM local l JOIN plan_modulo pm ON pm.plan_id = l.plan_id WHERE l.id = :local
                        ON CONFLICT (local_id, modulo) DO UPDATE SET habilitado = true, actualizado_at = now()""")
                .param("local", localId)
                .update();
    }

    private Set<Modulo> conjunto(String sql, int localId) {
        Set<Modulo> resultado = EnumSet.noneOf(Modulo.class);
        jdbc.sql(sql).param("local", localId).query(String.class).list().forEach(m -> resultado.add(Modulo.valueOf(m)));
        return resultado;
    }
}
