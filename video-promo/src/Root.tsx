import { Composition, Folder } from "remotion";
import { Cierre } from "./escenas/Cierre";
import { Gancho } from "./escenas/Gancho";
import { Negocio } from "./escenas/Negocio";
import { ParaQuien } from "./escenas/ParaQuien";
import { PasoAviso } from "./escenas/PasoAviso";
import { PasoEscanea } from "./escenas/PasoEscanea";
import { PasoSigue } from "./escenas/PasoSigue";
import { PasoTv } from "./escenas/PasoTv";
import { Problema } from "./escenas/Problema";
import { Revelacion } from "./escenas/Revelacion";
import { TurnoYaPromo } from "./TurnoYaPromo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="TurnoYaPromo" component={TurnoYaPromo} durationInFrames={1800} fps={30} width={1920} height={1080} />
      <Folder name="Escenas">
        <Composition id="Gancho" component={Gancho} durationInFrames={165} fps={30} width={1920} height={1080} defaultProps={{ linea1: "¿Cuánto tiempo pasas", linea2: "haciendo fila?" }} />
        <Composition
          id="Problema"
          component={Problema}
          durationInFrames={210}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ titulo: "De pie, sin saber cuánto falta.", remate: "Y muchos se van sin ser atendidos.", pregunta: "¿Cuánto falta?" }}
        />
        <Composition id="Marca" component={Revelacion} durationInFrames={165} fps={30} width={1920} height={1080} defaultProps={{ lema: "Tu fila, ahora en tu celular." }} />
        <Composition
          id="Escanea"
          component={PasoEscanea}
          durationInFrames={225}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ titulo: "Escanea el QR", frase: "Sin descargar apps ni crear cuentas. Eliges el servicio y listo." }}
        />
        <Composition
          id="SigueTuTurno"
          component={PasoSigue}
          durationInFrames={200}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ titulo: "Sigue tu turno", frase: "Ves en vivo cuántas personas faltan y cuánto tardará." }}
        />
        <Composition
          id="AvisoWhatsApp"
          component={PasoAviso}
          durationInFrames={195}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            titulo: "Te avisamos",
            frase: "Un WhatsApp te avisa cuando faltan 2 personas. Llegas justo a tiempo.",
            mensaje: "Hola María 👋, tu turno A-018 está por llegar: faltan 2 personas. Acércate a la sala.",
          }}
        />
        <Composition
          id="LlamadoTv"
          component={PasoTv}
          durationInFrames={195}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ titulo: "Te llaman", frase: "Tu número aparece en la TV de la sala con timbre, y tu celular vibra.", codigo: "A-018", ventanilla: "Consultorio 2" }}
        />
        <Composition id="Negocio" component={Negocio} durationInFrames={255} fps={30} width={1920} height={1080} defaultProps={{ titulo: "Y tu negocio atiende mejor" }} />
        <Composition
          id="ParaQuien"
          component={ParaQuien}
          durationInFrames={165}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ titulo: "Para cualquier sala de espera", subtitulo: "Si tus clientes esperan, TurnoYa los ordena." }}
        />
        <Composition id="Cierre" component={Cierre} durationInFrames={160} fps={30} width={1920} height={1080} defaultProps={{ lema: "Espera donde quieras.", llamado: "Empieza gratis hoy", web: "turnoya.pe" }} />
      </Folder>
    </>
  );
};
