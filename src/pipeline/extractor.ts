import { Transcription, ExtractedIncident } from "./types.js";
import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are a dispatch audio parser. You receive transcriptions of emergency dispatch radio communications and extract structured incident data.

Common dispatch abbreviations:
- E12, ENG12 = Engine 12
- L5, LAD5, TRK5 = Ladder/Truck 5
- M3, MED3, A3 = Medic/Ambulance 3
- BC1 = Battalion Chief 1
- R1, RES1 = Rescue 1
- HM1 = Hazmat 1
- MVC, MVA = Motor Vehicle Collision/Accident
- PI = Personal Injury
- AFA = Automatic Fire Alarm
- RSF = Residential Structure Fire
- CSF = Commercial Structure Fire
- EMS = Emergency Medical Services
- DOA = Dead on Arrival
- GSW = Gunshot Wound
- OD = Overdose
- DUI = Driving Under the Influence
- "1200 block" = approximate location on a street
- "cross of X and Y" or "X/Y" = intersection of two streets
- Code 3 = lights and sirens (urgent)
- Code 4 = no further assistance needed

You must respond with JSON. If the transcription contains an actionable dispatch, respond with:
{"actionable": true, "location": "...", "incidentType": "...", "units": ["..."], "timestamp": "..."}

If the transcription does NOT contain an actionable dispatch (just chatter, acknowledgments, or unintelligible audio), respond with:
{"actionable": false}`;

/**
 * Sends transcription to Ollama to extract structured incident data.
 * Uses JSON format mode for structured output.
 * Returns null if no actionable dispatch was found.
 */
export async function extractIncident(
  transcription: Transcription
): Promise<ExtractedIncident | null> {
  try {
    const result = await withRetry(
      () => callOllama(transcription.text),
      3,
      2000
    );
    return result;
  } catch (err) {
    logger.error("Extraction failed after retries", err);
    return null;
  }
}

async function callOllama(text: string): Promise<ExtractedIncident | null> {
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract the dispatch incident from this radio transcription.\n\nTranscription: "${text}"`,
        },
      ],
      format: "json",
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data?.message?.content) {
    throw new Error("Ollama returned unexpected response structure");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data.message.content);
  } catch {
    throw new Error(`Ollama returned invalid JSON: ${data.message.content.slice(0, 200)}`);
  }

  if (!parsed.actionable) {
    logger.debug("No actionable dispatch found in transcription");
    return null;
  }

  if (typeof parsed.location !== "string" || typeof parsed.incidentType !== "string") {
    throw new Error("Ollama response missing required fields (location, incidentType)");
  }

  // Normalize timestamp
  const timestamp =
    parsed.timestamp === "now" || !parsed.timestamp
      ? new Date().toISOString()
      : String(parsed.timestamp);

  return {
    location: parsed.location,
    incidentType: parsed.incidentType,
    units: Array.isArray(parsed.units) ? parsed.units.map(String) : [],
    timestamp,
    rawTranscription: text,
  };
}
