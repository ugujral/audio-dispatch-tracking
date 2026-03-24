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

/**
 * Extracts the feed ID from a Broadcastify CDN URL.
 * e.g. "https://broadcastify.cdnstream1.com/26569" → "26569"
 */
function extractFeedId(streamUrl: string): string | null {
  const match = streamUrl.match(/broadcastify\.cdnstream\d*\.com\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Fetches the stream name from Broadcastify's web player page title.
 * Returns empty string if fetch fails or URL is not a Broadcastify feed.
 */
export async function fetchStreamName(streamUrl: string): Promise<string> {
  const feedId = extractFeedId(streamUrl);
  if (!feedId) return "";

  try {
    const resp = await fetch(`https://www.broadcastify.com/webPlayer/${feedId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await resp.text();
    const match = html.match(/<title>\s*(.+?)\s*<\/title>/i);
    if (match) {
      return match[1].replace(/\s*Live Audio Feed\s*$/i, "").trim();
    }
  } catch {
    // ignore — name is optional
  }
  return "";
}

export const config = {
  streamUrl: requireEnv("STREAM_URL"),
  streamName: process.env.STREAM_NAME || "",
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.1:8b",
  whisperModel: process.env.WHISPER_MODEL || "medium.en",
  whisperPath: process.env.WHISPER_PATH || "scripts/transcribe.py",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  geocodeCity: process.env.GEOCODE_CITY || "",
  geocodeState: process.env.GEOCODE_STATE || "",
  geocodeCountry: process.env.GEOCODE_COUNTRY || "US",
  port: parseInt(process.env.PORT || "3000", 10),
  mapCenterLat: parseFloat(process.env.MAP_CENTER_LAT || "34.0522"),
  mapCenterLng: parseFloat(process.env.MAP_CENTER_LNG || "-118.2437"),
  mapZoom: parseInt(process.env.MAP_ZOOM || "12", 10),
  adSkipSeconds: parseInt(process.env.AD_SKIP_SECONDS || "30", 10),
  chunkDuration: parseInt(process.env.CHUNK_DURATION || "15", 10),
};
