import { Transcription, ExtractedIncident } from "./types.js";
import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are a dispatch audio parser. You receive transcriptions of emergency dispatch radio communications and extract structured incident data.

Common dispatch abbreviations:

Fire/EMS:
- E12, ENG12 = Engine 12
- L5, LAD5, TRK5 = Ladder/Truck 5
- M3, MED3, A3 = Medic/Ambulance 3
- BC1 = Battalion Chief 1
- R1, RES1 = Rescue 1
- HM1 = Hazmat 1
- AFA = Automatic Fire Alarm
- RSF = Residential Structure Fire
- CSF = Commercial Structure Fire
- EMS = Emergency Medical Services

Police/Law Enforcement:
- 1-Adam-12, 2-Lincoln-30 = patrol unit designators (use as-is, e.g., "1-Adam-12")
- 211 = Robbery
- 459 = Burglary
- 487 = Grand Theft
- 415 = Disturbance
- 242 = Battery
- 245 = Assault with Deadly Weapon
- 261 = Sexual Assault
- 273 = Child Abuse
- 288 = Lewd Conduct
- 314 = Indecent Exposure
- 390 = Drunk in Public
- 417 = Person with a Gun
- 459 = Burglary
- 484 = Theft
- 502 = DUI
- 586 = Illegal Parking
- 594 = Malicious Mischief/Vandalism
- 647 = Disorderly Conduct
- 10-15 = Subject in Custody
- 10-20 = Location
- 10-97 = Arrived at Scene
- 10-98 = Finished Assignment

General:
- MVC, MVA = Motor Vehicle Collision/Accident
- PI = Personal Injury
- DOA = Dead on Arrival
- GSW = Gunshot Wound
- OD = Overdose
- DUI = Driving Under the Influence
- "1200 block" = approximate location on a street
- "cross of X and Y" or "X/Y" = intersection of two streets
- Code 3 = lights and sirens (urgent)
- Code 4 = no further assistance needed

IMPORTANT RULES:
- Extract any incident where you can identify BOTH a location AND an incident type. This includes new dispatches, active incidents being discussed, and ongoing situations.
- Do NOT extract: unit clearances (Code 4, 10-8, "clear"), acknowledgments ("copy", "10-4"), radio checks, or unintelligible audio.
- Always use full names, never abbreviations. For example: "Motor Vehicle Collision" not "MVC", "Burglary" not "459", "Robbery" not "211", "Battery" not "242".
- The location MUST include a street address, intersection, or well-known landmark/building name with enough detail to geocode it. A school name like "Wilson Middle School" is acceptable. A lone street name like "Washington" is NOT.
- The incidentType MUST be a specific type (e.g., "Burglary", "Traffic Collision", "Domestic Dispute", "Battery", "Welfare Check"). Never use "Unknown" or "Miscellaneous".
- For units: use the exact designator from the audio. If none mentioned, use an empty array.
- For timestamp: always use "now".

You must respond with JSON. If the transcription contains an incident with a clear location and type, respond with:
{"actionable": true, "location": "...", "incidentType": "...", "units": ["..."], "timestamp": "now"}

Otherwise respond with:
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
