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
export interface StreamInfo {
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

/**
 * Fetches stream name from Broadcastify and auto-detects the city/state
 * by geocoding the feed name. Returns all info needed to configure the app.
 */
export async function fetchStreamInfo(streamUrl: string): Promise<StreamInfo | null> {
  const feedId = extractFeedId(streamUrl);
  if (!feedId) return null;

  try {
    const resp = await fetch(`https://www.broadcastify.com/webPlayer/${feedId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await resp.text();
    const match = html.match(/<title>\s*(.+?)\s*<\/title>/i);
    if (!match) return null;

    const name = match[1].replace(/\s*Live Audio Feed\s*$/i, "").trim();

    // Extract city name from the feed title (e.g., "Indianapolis Metropolitan Police" → "Indianapolis")
    // Also try the meta description which often has more context
    const descMatch = html.match(/<meta\s+name="KEYWORDS"\s+content="([^"]+)"/i);
    const keywords = descMatch ? descMatch[1] : "";

    // Try to geocode the city — feed names usually start with city/county
    // Known agency abbreviations that map to cities
    const agencyMap: Record<string, string> = {
      "lapd": "Los Angeles",
      "nypd": "New York",
      "cpd": "Chicago",
      "sfpd": "San Francisco",
      "lafd": "Los Angeles",
      "fdny": "New York",
    };

    // Check if name starts with a known agency abbreviation
    const firstWord = name.split(/[\s-]/)[0].toLowerCase();
    let cityGuess = agencyMap[firstWord] || "";

    if (!cityGuess) {
      cityGuess = name
        .replace(/\b(police|fire|ems|dispatch|department|county|metropolitan|city of|sheriff|pd|bureau|division|district|north|south|east|west|central|valley)\b/gi, "")
        .replace(/[-–—]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(/\s*,\s*/)[0]
        .trim();
    }

    if (!cityGuess) return { name, city: "", state: "", lat: 0, lng: 0 };

    // Geocode the city to get coordinates
    const geoResp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityGuess + ", US")}&format=json&limit=1`,
      {
        headers: { "User-Agent": "DispatchTracker/1.0" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    const geoResults = await geoResp.json() as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    if (geoResults.length > 0) {
      const result = geoResults[0];
      // Parse city and state from display_name like "Indianapolis, Marion County, Indiana, US"
      const parts = result.display_name.split(", ");
      const city = parts[0] || cityGuess;
      const state = parts.length >= 3 ? parts[parts.length - 2] : "";

      return {
        name,
        city,
        state,
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
      };
    }

    return { name, city: cityGuess, state: "", lat: 0, lng: 0 };
  } catch {
    return null;
  }
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
