package pe.turnoya.prediccion.avisos;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import pe.turnoya.compartido.ErrorNegocio;
import pe.turnoya.compartido.config.PropiedadesTurnoYa;
import pe.turnoya.compartido.estadistica.Estadistica;
import pe.turnoya.compartido.tiempo.Fechas;
import pe.turnoya.notificaciones.AvisosAlCliente;
import pe.turnoya.nucleo.ContactoTurnos;
import pe.turnoya.plataforma.CatalogoLocales;
import pe.turnoya.plataforma.Modulo;
import pe.turnoya.plataforma.ModulosLocal;
import pe.turnoya.prediccion.dominio.RepositorioPrediccion;
import pe.turnoya.prediccion.estimacion.EstimadorM2;

/** RF-M2-06 "mejores horas" y RF-M2-07 "avisarme X min antes" (opt-in del cliente, se envía una sola vez). */
@Service
public class AvisosPorMinutos {

    private static final Set<Integer> OPCIONES = Set.of(5, 10, 15);

    private final RepositorioPrediccion repositorio;
    private final EstimadorM2 estimador;
    private final ModulosLocal modulos;
    private final ContactoTurnos contactos;
    private final AvisosAlCliente avisos;
    private final CatalogoLocales locales;
    private final PropiedadesTurnoYa propiedades;
    private final Clock reloj;

    AvisosPorMinutos(RepositorioPrediccion repositorio, EstimadorM2 estimador, ModulosLocal modulos, ContactoTurnos contactos, AvisosAlCliente avisos,
                     CatalogoLocales locales, PropiedadesTurnoYa propiedades, Clock reloj) {
        this.repositorio = repositorio;
        this.estimador = estimador;
        this.modulos = modulos;
        this.contactos = contactos;
        this.avisos = avisos;
        this.locales = locales;
        this.propiedades = propiedades;
        this.reloj = reloj;
    }

    public Map<String, Integer> configurar(String token, Integer minAntes) {
        if (minAntes != null && !OPCIONES.contains(minAntes)) {
            throw new ErrorNegocio("M2_AVISO_INVALIDO", "Elige 5, 10 o 15 minutos", 422);
        }
        var t = repositorio.turnoPorToken(token).orElseThrow(() -> ErrorNegocio.noEncontrado("TURNO_NO_ENCONTRADO", "El turno no existe"));
        if (!t.estado().equals("EMITIDO") && !t.estado().equals("AVISADO")) {
            throw ErrorNegocio.conflicto("TRANSICION_INVALIDA", "El turno ya no está en espera");
        }
        if (!modulos.activo(t.localId(), Modulo.M2)) {
            throw new ErrorNegocio("MODULO_NO_DISPONIBLE", "El aviso por tiempo no está disponible en este local", 403);
        }
        repositorio.configurarAviso(t.id(), minAntes);
        Map<String, Integer> r = new HashMap<>();
        r.put("avisoMinAntes", minAntes);
        return r;
    }

    /** Job: avisa a quienes ya están a X minutos o menos de ser llamados. */
    public Map<String, Object> jobAvisos() {
        Instant ahora = reloj.instant();
        int enviados = 0;
        for (var p : repositorio.avisosPendientes(200)) {
            if (!modulos.activo(p.localId(), Modulo.M2)) {
                continue;
            }
            int posicion = repositorio.posicion(p.turnoId());
            var pred = estimador.predecir(p.colaId(), Math.max(0, posicion - 1), ahora);
            if (pred.segundos() > p.minAntes() * 60) {
                continue;
            }
            if (!repositorio.marcarAvisoEnviado(p.turnoId(), ahora)) {
                continue;
            }
            var c = contactos.de(p.turnoId()).orElse(null);
            if (c == null) {
                continue;
            }
            int min = Math.max(1, (int) Math.ceil(pred.segundos() / 60.0));
            String url = propiedades.urlPublica() + "/t/" + c.token();
            avisos.deTurno(c.localId(), c.turnoId(), c.telefonoE164(), "turno_proximo", List.of(c.codigo(), c.localNombre()),
                    "⏳ Tu turno *" + c.codigo() + "* en *" + c.localNombre() + "* será llamado en unos " + min + " min. Acércate a la sala. " + url);
            enviados++;
        }
        return Map.of("enviados", enviados);
    }

    public record FranjaEspera(String franja, long esperaMin, String nivel) {
    }

    /** §6.10 Espera media real por franja de hoy (8 semanas), suavizada y con contracción; solo el resto del día. */
    public List<FranjaEspera> mejoresHoras(int colaId) {
        var cola = repositorio.cola(colaId).orElseThrow(() -> ErrorNegocio.noEncontrado("COLA_INACTIVA", "La cola no existe"));
        var zona = locales.exigir(cola.localId()).zonaHoraria();
        Instant ahora = reloj.instant();
        var hoy = Fechas.partes(zona, ahora);
        Map<Integer, List<Double>> porFranja = new HashMap<>();
        List<Double> todas = new ArrayList<>();
        for (var r : repositorio.esperas(colaId, ahora.minus(Duration.ofDays(56)))) {
            var f = Fechas.partes(zona, r.emitidoAt());
            if (f.diaSemana() != hoy.diaSemana()) {
                continue;
            }
            double min = (r.llamadoAt().toEpochMilli() - r.emitidoAt().toEpochMilli()) / 60000.0;
            if (min < 0 || min > 240) {
                continue;
            }
            porFranja.computeIfAbsent(f.hora() * 2 + f.minuto() / 30, k -> new ArrayList<>()).add(min);
            todas.add(min);
        }
        if (todas.size() < 10) {
            return List.of();
        }
        double mediaCola = Estadistica.media(todas);
        int k = 5;
        Map<Integer, Double> bruto = new TreeMap<>();
        porFranja.forEach((f, xs) -> bruto.put(f, (xs.size() * Estadistica.media(xs) + k * mediaCola) / (xs.size() + k)));
        int actual = hoy.hora() * 2 + hoy.minuto() / 30;
        List<double[]> suav = new ArrayList<>();
        for (int f : bruto.keySet()) {
            if (f <= actual) {
                continue;
            }
            List<Double> vecinos = new ArrayList<>();
            for (int x = f - 1; x <= f + 1; x++) {
                if (bruto.containsKey(x)) {
                    vecinos.add(bruto.get(x));
                }
            }
            suav.add(new double[] {f, Estadistica.media(vecinos)});
        }
        double[] valores = suav.stream().mapToDouble(s -> s[1]).toArray();
        double p33 = Estadistica.cuantil(valores, 0.33);
        double p66 = Estadistica.cuantil(valores, 0.66);
        return suav.stream().map(s -> {
            int f = (int) s[0];
            return new FranjaEspera(LocalTime.of(f / 2, f % 2 == 1 ? 30 : 0).toString(), Math.round(s[1]),
                    s[1] < p33 ? "baja" : s[1] > p66 ? "alta" : "media");
        }).toList();
    }
}
