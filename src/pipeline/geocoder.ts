import NodeGeocoder from "node-geocoder";
import { ExtractedIncident, GeocodedIncident } from "./types.js";
import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const geocoder = NodeGeocoder({
  provider: "openstreetmap",
});

/**
 * Geocodes the incident location using Nominatim (OpenStreetMap).
 * Appends city/state for disambiguation.
 * Returns null if geocoding fails.
 */
export async function geocodeIncident(
  incident: ExtractedIncident
): Promise<GeocodedIncident | null> {
  // Try the full location first
  const coords = await tryGeocode(incident.location);
  if (coords) {
    return { ...incident, ...coords };
  }

  // If it looks like an intersection, try each street separately and average
  const streets = splitIntersection(incident.location);
  if (streets) {
    const [a, b] = streets;
    const coordsA = await tryGeocode(a);
    const coordsB = await tryGeocode(b);
    if (coordsA && coordsB) {
      const lat = (coordsA.lat + coordsB.lat) / 2;
      const lng = (coordsA.lng + coordsB.lng) / 2;
      logger.info(
        `Geocoded intersection "${incident.location}" → (${lat}, ${lng})`
      );
      return { ...incident, lat, lng };
    }
    // Fall back to whichever street resolved
    const fallback = coordsA || coordsB;
    if (fallback) {
      return { ...incident, ...fallback };
    }
  }

  logger.warn(`Could not geocode: "${incident.location}"`);
  return null;
}

async function tryGeocode(
  location: string
): Promise<{ lat: number; lng: number } | null> {
  const query = buildQuery(location);
  try {
    const results = await withRetry(() => geocoder.geocode(query), 2, 1500);
    if (!results || results.length === 0) return null;
    const best = results[0];
    if (best.latitude == null || best.longitude == null) return null;
    logger.info(`Geocoded "${location}" → (${best.latitude}, ${best.longitude})`);
    return { lat: best.latitude, lng: best.longitude };
  } catch {
    return null;
  }
}

function splitIntersection(location: string): [string, string] | null {
  const patterns = [/ and /i, / & /, / at /i, /\//];
  for (const p of patterns) {
    const parts = location.split(p);
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return [parts[0].trim(), parts[1].trim()];
    }
  }
  return null;
}

/**
 * Cleans up dispatch-specific phrasing and appends locality.
 * Examples:
 *   "1200 block of Main St" → "1200 Main St, Los Angeles, CA"
 *   "Main and 5th" → "Main and 5th, Los Angeles, CA"
 */
function buildQuery(location: string): string {
  let cleaned = location
    .replace(/\bblock of\b/gi, "")
    .replace(/\bcross of\b/gi, "and")
    .replace(/\s+/g, " ")
    .trim();

  const parts = [cleaned];
  if (config.geocodeCity) parts.push(config.geocodeCity);
  if (config.geocodeState) parts.push(config.geocodeState);
  if (config.geocodeCountry) parts.push(config.geocodeCountry);

  return parts.join(", ");
}
