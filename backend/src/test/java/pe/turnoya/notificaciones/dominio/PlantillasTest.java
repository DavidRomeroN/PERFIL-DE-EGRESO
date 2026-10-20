package pe.turnoya.notificaciones.dominio;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Textos de WhatsApp: deben coincidir con las plantillas aprobadas (mismos textos que legacy/). */
class PlantillasTest {

    @Test
    void turnoProximoSaludaPorElPrimerNombre() {
        assertThat(Plantillas.turnoProximo("María José", "A-012", "Policlínico", 2, "https://t.pe/t/ABC"))
                .isEqualTo("Hola María 👋, tu turno *A-012* en *Policlínico* está por llegar: faltan 2 personas. "
                        + "Acércate a la sala. Sigue tu turno aquí: https://t.pe/t/ABC");
    }

    @Test
    void turnoProximoSinNombreYUnaPersona() {
        assertThat(Plantillas.turnoProximo(null, "B-001", "Banco", 1, "u")).startsWith("Hola 👋, tu turno *B-001*").contains("falta 1 persona");
        assertThat(Plantillas.turnoProximo(" ", "B-001", "Banco", 0, "u")).contains("ya casi es tu turno");
    }

    @Test
    void turnoLlamado() {
        assertThat(Plantillas.turnoLlamado("A-003", "Ventanilla 2", "Policlínico"))
                .isEqualTo("📣 *A-003*, es tu turno en *Policlínico*. Acércate a *Ventanilla 2*.");
    }
}
