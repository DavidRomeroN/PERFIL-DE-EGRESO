// Genera la narración con ElevenLabs (modelo multilingüe) → public/narracion/NN-id.mp3
// Requiere video-promo/.env con ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID.
// Uso: node --env-file=.env scripts/narracion-elevenlabs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUION } from "./guion.mjs";

const { ELEVENLABS_API_KEY: clave, ELEVENLABS_VOICE_ID: voz } = process.env;
if (!clave || !voz) throw new Error("Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env");

const destino = join(process.cwd(), "public", "narracion");
mkdirSync(destino, { recursive: true });

for (const [i, linea] of GUION.entries()) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": clave, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: linea.texto,
      model_id: "eleven_multilingual_v2",
      language_code: "es",
      // Frases vecinas como contexto: la entonación fluye como un solo locutor de principio a fin
      previous_text: GUION[i - 1]?.texto,
      next_text: GUION[i + 1]?.texto,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`${linea.id}: HTTP ${res.status} ${await res.text()}`);
  writeFileSync(join(destino, `${linea.id}.mp3`), Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${linea.id}`);
}
