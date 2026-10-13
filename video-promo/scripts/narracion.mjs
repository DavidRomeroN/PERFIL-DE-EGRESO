// Alternativa sin cuenta: narración con la voz neural peruana "Camila" (es-PE) de Microsoft Edge.
// Uso: node scripts/narracion.mjs   → escribe public/narracion/NN-id.mp3
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { GUION } from "./guion.mjs";

const VOZ = "es-PE-CamilaNeural";


const destino = join(process.cwd(), "public", "narracion");
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

const tts = new MsEdgeTTS();
await tts.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

for (const linea of GUION) {
  const tmp = join(destino, `tmp-${linea.id}`);
  mkdirSync(tmp, { recursive: true });
  const { audioFilePath } = await tts.toFile(tmp, linea.texto, { rate: "+6%", pitch: "+0Hz" });
  renameSync(audioFilePath, join(destino, `${linea.id}.mp3`));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ ${linea.id}`);
}
tts.close();
console.log(readdirSync(destino).join("\n"));
