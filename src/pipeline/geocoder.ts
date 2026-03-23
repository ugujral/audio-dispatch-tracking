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
  const query = buildQuery(incident.location);

  try {
    const results = await withRetry(() => geocoder.geocode(query), 2, 1500);

    if (!results || results.length === 0) {
      logger.warn(`Geocoding returned no results for: "${query}"`);
      return null;
    }

    const best = results[0];
    if (best.latitude == null || best.longitude == null) {
      logger.warn(`Geocoding result missing coordinates for: "${query}"`);
      return null;
    }

    logger.info(
      `Geocoded "${incident.location}" → (${best.latitude}, ${best.longitude})`
    );

    return {
      ...incident,
      lat: best.latitude,
      lng: best.longitude,
    };
  } catch (err) {
    logger.error(`Geocoding failed for: "${query}"`, err);
    return null;
  }
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
