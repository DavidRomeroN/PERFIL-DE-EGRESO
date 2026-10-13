import { Audio } from "@remotion/media";
import { linearTiming, springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
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

/**
 * Spot publicitario de TurnoYa · 60 s (1800 cuadros a 30 fps).
 * Guion: gancho → problema → marca → 4 pasos (escanea, sigue, aviso, TV) → negocio → para quién → cierre.
 * Las 10 escenas suman 1935 cuadros; las 9 transiciones de 15 cuadros se solapan (135), total 1800.
 * La narración (voz "Jessica" de ElevenLabs, generada con scripts/narracion-elevenlabs.mjs) entra 10 cuadros después de cada corte.
 */
// Tramos (en cuadros) en que suena la narradora: la música baja en ellos
const VOCES = [
  [10, 80],
  [160, 308],
  [355, 464],
  [505, 682],
  [715, 836],
  [900, 991],
  [1080, 1172],
  [1260, 1479],
  [1500, 1639],
  [1650, 1781],
] as const;

/** Volumen de la música: 0.16 bajo la voz, 0.5 en las pausas, con 12 cuadros de transición. */
const volumenMusica = (frame: number) => {
  const distancia = Math.min(...VOCES.map(([a, b]) => (frame < a ? a - frame : frame > b ? frame - b : 0)));
  return interpolate(distancia, [0, 12], [0.16, 0.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

export const TurnoYaPromo = () => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  return (
    <>
      <TransitionSeries name="Escenas">
        <TransitionSeries.Sequence name="1 · Gancho" durationInFrames={165} premountFor={fps}>
          <Gancho linea1="¿Cuánto tiempo pasas" linea2="haciendo fila?" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="2 · Problema" durationInFrames={210} premountFor={fps}>
          <Problema titulo="De pie, sin saber cuánto falta." remate="Y muchos se van sin ser atendidos." pregunta="¿Cuánto falta?" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="3 · Marca" durationInFrames={165} premountFor={fps}>
          <Revelacion lema="Tu fila, ahora en tu celular." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="4 · Escanea" durationInFrames={225} premountFor={fps}>
          <PasoEscanea titulo="Escanea el QR" frase="Sin descargar apps ni crear cuentas. Eliges el servicio y listo." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="5 · Sigue tu turno" durationInFrames={200} premountFor={fps}>
          <PasoSigue titulo="Sigue tu turno" frase="Ves en vivo cuántas personas faltan y cuánto tardará." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="6 · Aviso WhatsApp" durationInFrames={195} premountFor={fps}>
          <PasoAviso
            titulo="Te avisamos"
            frase="Un WhatsApp te avisa cuando faltan 2 personas. Llegas justo a tiempo."
            mensaje="Hola María 👋, tu turno A-018 está por llegar: faltan 2 personas. Acércate a la sala."
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={springTiming({ config: { damping: 200 }, durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="7 · Llamado en TV" durationInFrames={195} premountFor={fps}>
          <PasoTv titulo="Te llaman" frase="Tu número aparece en la TV de la sala con timbre, y tu celular vibra." codigo="A-018" ventanilla="Consultorio 2" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="8 · Negocio" durationInFrames={255} premountFor={fps}>
          <Negocio titulo="Y tu negocio atiende mejor" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="9 · Para quién" durationInFrames={165} premountFor={fps}>
          <ParaQuien titulo="Para cualquier sala de espera" subtitulo="Si tus clientes esperan, TurnoYa los ordena." />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
        <TransitionSeries.Sequence name="10 · Cierre" durationInFrames={160} premountFor={fps}>
          <Cierre lema="Espera donde quieras." llamado="Empieza gratis hoy" web="turnoya.pe" />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Cama musical propia (acordes Do–Sol–Lam–Fa) que se agacha cuando habla la narradora */}
      <Sequence name="Música de fondo" durationInFrames={1800} premountFor={fps}>
        <Audio src={staticFile("musica/fondo.mp3")} volume={volumenMusica(frame)} />
      </Sequence>

      {/* Narradora: voz "Jessica" de ElevenLabs (modelo multilingüe). Cada frase entra 10 cuadros después del corte de su escena. */}
      <Sequence name="Voz · Gancho" from={10} durationInFrames={80} premountFor={fps}>
        <Audio src={staticFile("narracion/01-gancho.mp3")} />
      </Sequence>
      <Sequence name="Voz · Problema" from={160} durationInFrames={160} premountFor={fps}>
        <Audio src={staticFile("narracion/02-problema.mp3")} />
      </Sequence>
      <Sequence name="Voz · Marca" from={355} durationInFrames={120} premountFor={fps}>
        <Audio src={staticFile("narracion/03-marca.mp3")} />
      </Sequence>
      <Sequence name="Voz · Escanea" from={505} durationInFrames={190} premountFor={fps}>
        <Audio src={staticFile("narracion/04-escanea.mp3")} />
      </Sequence>
      <Sequence name="Voz · Sigue tu turno" from={715} durationInFrames={135} premountFor={fps}>
        <Audio src={staticFile("narracion/05-sigue.mp3")} />
      </Sequence>
      <Sequence name="Voz · Aviso" from={900} durationInFrames={105} premountFor={fps}>
        <Audio src={staticFile("narracion/06-aviso.mp3")} />
      </Sequence>
      <Sequence name="Voz · TV" from={1080} durationInFrames={105} premountFor={fps}>
        <Audio src={staticFile("narracion/07-tv.mp3")} />
      </Sequence>
      <Sequence name="Voz · Negocio" from={1260} durationInFrames={230} premountFor={fps}>
        <Audio src={staticFile("narracion/08-negocio.mp3")} />
      </Sequence>
      <Sequence name="Voz · Para quién" from={1500} durationInFrames={140} premountFor={fps}>
        <Audio src={staticFile("narracion/09-para-quien.mp3")} />
      </Sequence>
      <Sequence name="Voz · Cierre" from={1650} durationInFrames={150} premountFor={fps}>
        <Audio src={staticFile("narracion/10-cierre.mp3")} />
      </Sequence>

      {/* Un "whoosh" suave en cada cambio de escena */}
      <Sequence name="Whoosh 1→2" from={146} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 2→3" from={341} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 3→4" from={491} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 4→5" from={701} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 5→6" from={886} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 6→7" from={1066} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 7→8" from={1246} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 8→9" from={1486} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
      <Sequence name="Whoosh 9→10" from={1636} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.18} />
      </Sequence>
    </>
  );
};
