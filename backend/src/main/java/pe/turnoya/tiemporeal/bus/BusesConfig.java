package pe.turnoya.tiemporeal.bus;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Elige el bus de tiempo real:
 * <ul>
 *   <li>{@code memoria} (por defecto): una sola instancia; el evento va directo a sus conexiones.</li>
 *   <li>{@code redis}: varias réplicas; cada una publica en el canal {@code turnoya:eventos} y todas reparten a sus
 *       propias conexiones (resuelve el riesgo 1 del plan: el bus en memoria no escala horizontalmente).</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
class BusesConfig {

    static final String CANAL = "turnoya:eventos";
    private static final Logger log = LoggerFactory.getLogger(BusesConfig.class);

    @Bean
    @ConditionalOnProperty(name = "turnoya.tiempo-real.bus", havingValue = "memoria", matchIfMissing = true)
    BusTiempoReal busEnMemoria(Repartidor repartidor) {
        return repartidor::repartir;
    }

    @Bean
    @ConditionalOnProperty(name = "turnoya.tiempo-real.bus", havingValue = "redis")
    BusTiempoReal busRedis(StringRedisTemplate redis, ObjectMapper json) {
        return evento -> redis.convertAndSend(CANAL, json.writeValueAsString(evento.comoJson()));
    }

    @Bean
    @ConditionalOnProperty(name = "turnoya.tiempo-real.bus", havingValue = "redis")
    RedisMessageListenerContainer oyenteRedis(RedisConnectionFactory conexion, Repartidor repartidor, ObjectMapper json) {
        RedisMessageListenerContainer contenedor = new RedisMessageListenerContainer();
        contenedor.setConnectionFactory(conexion);
        contenedor.addMessageListener((mensaje, patron) -> {
            try {
                Map<String, Object> datos = json.readValue(mensaje.getBody(), new TypeReference<Map<String, Object>>() { });
                String tipo = String.valueOf(datos.remove("tipo"));
                int localId = ((Number) datos.remove("localId")).intValue();
                repartidor.repartir(new EventoTiempoReal(tipo, localId, datos));
            } catch (RuntimeException e) {
                log.warn("Evento de Redis inválido: {}", e.getMessage());
            }
        }, new ChannelTopic(CANAL));
        return contenedor;
    }
}
