import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing required environment variable: ${key}`);
    console.error(`Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
  return val;
}

export const config = {
  streamUrl: requireEnv("STREAM_URL"),
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.1:8b",
  whisperModel: process.env.WHISPER_MODEL || "base.en",
  whisperPath: process.env.WHISPER_PATH || "whisper",
  geocodeCity: process.env.GEOCODE_CITY || "",
  geocodeState: process.env.GEOCODE_STATE || "",
  geocodeCountry: process.env.GEOCODE_COUNTRY || "US",
  port: parseInt(process.env.PORT || "3000", 10),
  mapCenterLat: parseFloat(process.env.MAP_CENTER_LAT || "34.0522"),
  mapCenterLng: parseFloat(process.env.MAP_CENTER_LNG || "-118.2437"),
  mapZoom: parseInt(process.env.MAP_ZOOM || "12", 10),
  adSkipSeconds: parseInt(process.env.AD_SKIP_SECONDS || "30", 10),
};
