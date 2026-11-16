package pe.turnoya.analitica.alertas;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import pe.turnoya.analitica.dominio.ReglasAnalitica;
import pe.turnoya.analitica.dominio.RepositorioAnalitica;
import pe.turnoya.analitica.dominio.RepositorioAnalitica.ReglaAlerta;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Reglas de alerta del local: listar (siembra las por defecto), crear, editar (umbral, niveles, activa, silencio) y borrar. */
@Service
public class ReglasDeAlerta {

    private static final Set<String> CANALES = Set.of("IN_APP", "WHATSAPP", "CORREO");

    private final RepositorioAnalitica repositorio;
    private final MotorAlertas motor;
    private final ModulosLocal modulos;
    private final ObjectMapper json;

    ReglasDeAlerta(RepositorioAnalitica repositorio, MotorAlertas motor, ModulosLocal modulos, ObjectMapper json) {
        this.repositorio = repositorio;
        this.motor = motor;
        this.modulos = modulos;
        this.json = json;
    }

    public record VistaRegla(int id, String tipo, String nombreTipo, String nombre, Map<String, Object> umbral, List<ReglasAnalitica.Nivel> niveles,
                             int resolverTrasMin, Instant silenciadaHasta, boolean activa) {

        public String textoUmbral() {
            return umbral.isEmpty() ? "—" : String.join(", ", umbral.entrySet().stream().map(e -> e.getKey() + ": " + e.getValue()).toList());
        }
    }

    public record Datos(String tipo, String nombre, Map<String, Object> umbral, List<ReglasAnalitica.Nivel> niveles, Integer resolverTrasMin, Boolean activa,
                        Instant silenciadaHasta, boolean quitarSilencio) {
    }

    @Transactional
    public List<VistaRegla> listar(int localId) {
        modulos.exigir(localId, Modulo.M7);
        motor.sembrar(localId);
        return repositorio.reglas(localId).stream().map(this::vista).toList();
    }

    @Transactional
    public VistaRegla crear(int localId, Datos d) {
        modulos.exigir(localId, Modulo.M7);
        if (d.tipo() == null || !MotorAlertas.TIPOS_MEDIDOS.contains(d.tipo())) {
            throw new ErrorNegocio("M7_REGLA_INVALIDA", "Tipo de alerta inválido", 422);
        }
        String nombre = nombre(d.nombre());
        var niveles = niveles(d.niveles() == null ? ReglasAnalitica.NIVELES_POR_DEFECTO : d.niveles());
        int resolver = resolver(d.resolverTrasMin() == null ? 10 : d.resolverTrasMin());
        repositorio.crearRegla(localId, d.tipo(), nombre, json.writeValueAsString(umbral(d.umbral())), json.writeValueAsString(niveles), resolver);
        return vista(repositorio.reglas(localId).getLast());
    }

    @Transactional
    public VistaRegla editar(int localId, int id, Datos d) {
        modulos.exigir(localId, Modulo.M7);
        ReglaAlerta r = exigir(localId, id);
        String nombre = d.nombre() == null ? r.nombre() : nombre(d.nombre());
        String umbral = d.umbral() == null ? r.umbralJson() : json.writeValueAsString(umbral(d.umbral()));
        String niveles = d.niveles() == null ? r.nivelesJson() : json.writeValueAsString(niveles(d.niveles()));
        int resolver = d.resolverTrasMin() == null ? r.resolverTrasMin() : resolver(d.resolverTrasMin());
        Instant silencio = d.quitarSilencio() ? null : d.silenciadaHasta() != null ? d.silenciadaHasta() : r.silenciadaHasta();
        repositorio.actualizarRegla(id, nombre, umbral, niveles, resolver, d.activa() == null ? r.activa() : d.activa(), silencio);
        return vista(exigir(localId, id));
    }

    @Transactional
    public void eliminar(int localId, int id) {
        modulos.exigir(localId, Modulo.M7);
        if (!repositorio.eliminarRegla(id, localId)) {
            throw new ErrorNegocio("M7_REGLA_INVALIDA", "La regla no existe", 404);
        }
    }

    private ReglaAlerta exigir(int localId, int id) {
        return repositorio.regla(id, localId).orElseThrow(() -> new ErrorNegocio("M7_REGLA_INVALIDA", "La regla no existe", 404));
    }

    private static String nombre(String n) {
        String x = n == null ? "" : n.trim();
        if (x.length() < 3 || x.length() > 80) {
            throw new ErrorNegocio("VALIDACION", "El nombre debe tener de 3 a 80 caracteres", 422);
        }
        return x;
    }

    private static Map<String, Object> umbral(Map<String, Object> u) {
        if (u == null) {
            return Map.of();
        }
        if (u.values().stream().anyMatch(v -> !(v instanceof Number))) {
            throw new ErrorNegocio("VALIDACION", "El umbral solo admite números", 422);
        }
        return u;
    }

    private static List<ReglasAnalitica.Nivel> niveles(List<ReglasAnalitica.Nivel> n) {
        if (n.isEmpty() || n.size() > 3 || n.stream().anyMatch(x -> x.traMin() < 0 || x.traMin() > 1440 || x.canales() == null || x.canales().isEmpty()
                || !CANALES.containsAll(x.canales()))) {
            throw new ErrorNegocio("VALIDACION", "Niveles inválidos (1 a 3, con canales IN_APP, WHATSAPP o CORREO)", 422);
        }
        return n;
    }

    private static int resolver(int v) {
        if (v < 1 || v > 240) {
            throw new ErrorNegocio("VALIDACION", "La autorresolución debe estar entre 1 y 240 min", 422);
        }
        return v;
    }

    private VistaRegla vista(ReglaAlerta r) {
        Map<String, Object> u;
        List<ReglasAnalitica.Nivel> n;
        try {
            u = json.readValue(r.umbralJson(), new TypeReference<Map<String, Object>>() {
            });
        } catch (RuntimeException e) {
            u = Map.of();
        }
        try {
            n = json.readValue(r.nivelesJson(), new TypeReference<List<ReglasAnalitica.Nivel>>() {
            });
        } catch (RuntimeException e) {
            n = ReglasAnalitica.NIVELES_POR_DEFECTO;
        }
        return new VistaRegla(r.id(), r.tipo(), MotorAlertas.TIPOS.getOrDefault(r.tipo(), r.tipo()), r.nombre(), u, n, r.resolverTrasMin(), r.silenciadaHasta(),
                r.activa());
    }
}
