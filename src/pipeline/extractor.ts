import { Transcription, ExtractedIncident } from "./types.js";
import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are an LAPD dispatch audio parser. You receive transcriptions of Los Angeles Police Department radio communications and extract structured incident data.

LAPD PHONETIC ALPHABET (used in unit callsigns):
A=Adam, B=Boy, C=Charles, D=David, E=Edward, F=Frank, G=George, H=Henry, I=Ida, J=John, K=King, L=Lincoln, M=Mary, N=Nora, O=Ocean, P=Paul, Q=Queen, R=Robert, S=Sam, T=Tom, U=Union, V=Victor, W=William, X=Xray, Y=Young, Z=Zebra

LAPD UNIT DESIGNATORS:
- Format: [Division#]-[Type]-[Beat#], e.g., "9-Adam-45" = Van Nuys Division, two-officer patrol, beat 45
- A = Two-officer patrol car (Adam unit)
- L = One-officer patrol car (Lincoln unit)
- X = Extra patrol unit
- M = Motorcycle (Mary unit)
- E = Traffic enforcement car
- G = Gang unit
- K9 = Canine unit
- W = Detective
- S/SL = Senior Lead Officer

LAPD VALLEY BUREAU DIVISIONS:
- 9 = Van Nuys, 10 = West Valley, 15 = North Hollywood, 16 = Foothill, 17 = Devonshire, 19 = Mission, 21 = Topanga, 23 = Valley Traffic

CALIFORNIA PENAL CODES (used as incident types on radio):
- 187 = Homicide/Murder
- 207 = Kidnapping
- 211 = Robbery
- 215 = Carjacking
- 217 = Assault with intent to murder
- 220 = Assault with intent to commit rape
- 236 = False imprisonment
- 240/242 = Assault/Battery
- 243 = Battery on a peace officer
- 245 = Assault with Deadly Weapon (ADW)
- 246 = Shooting at inhabited dwelling
- 261 = Rape
- 266 = Pimping/Pandering
- 273 = Child abuse
- 288 = Lewd conduct with a minor
- 311 = Indecent exposure
- 314 = Indecent exposure (alternate)
- 390 = Drunk in public
- 415 = Disturbance/Disturbing the peace
- 417 = Brandishing a weapon/Person with a gun
- 419 = Dead body found
- 451 = Arson
- 459 = Burglary
- 470 = Forgery
- 484 = Theft/Petty theft
- 487 = Grand theft
- 488 = Petty theft
- 496 = Receiving stolen property
- 502 = Drunk driving/DUI
- 507 = Minor disturbance
- 586 = Illegal parking
- 594 = Vandalism/Malicious mischief
- 597 = Animal cruelty
- 647 = Disorderly conduct/Loitering
- 653 = Threatening phone calls
- 5150 = Mental health hold/Mentally unstable person
- 10851 = Vehicle theft (CA Vehicle Code)
- 11350 = Possession of controlled substance
- 11550 = Under the influence of controlled substance
- 20001 = Hit and run with injury
- 20002 = Hit and run property damage
- 23152 = DUI (CA Vehicle Code)

LAPD STATUS/OPERATIONAL CODES:
- Code 1 = Acknowledge/Respond on radio
- Code 2 = Routine response (no lights/siren)
- Code 2 High = Urgent (lights, no siren)
- Code 3 = Emergency (lights and siren)
- Code 4 = No further assistance needed
- Code 4 Adam = No additional units, suspect NOT in custody
- Code 5 = Stakeout
- Code 6 = On scene/Out for investigation
- Code 6 Charles = On scene, suspect is wanted
- Code 7 = Meal break
- Code 10 = Clear the frequency
- Code 12 = False alarm
- Code 20 = Media in area
- Code 30 = Burglar alarm (silent or audible)
- Code 37 = Stolen vehicle
- Code 99 = Officer emergency/Officer down
- Code Robert = Deploy rifle
- Code Sam = Deploy less-lethal shotgun
- Code Tom = Deploy taser

LAPD 10-CODES:
- 10-4 = Acknowledged/OK
- 10-7 = Out of service
- 10-8 = In service/Available
- 10-9 = Repeat
- 10-11 = Talk slower
- 10-15 = Subject in custody
- 10-20 = Location
- 10-29 = Records check
- 10-97 = Arrived at scene
- 10-98 = Finished assignment

COMMON LAPD ABBREVIATIONS:
- ADW = Assault with Deadly Weapon
- BOLO = Be On the Lookout
- DB = Dead body
- DOA = Dead on arrival
- DV = Domestic violence
- FTA = Failure to appear
- GOA = Gone on arrival
- GSW = Gunshot wound
- GTA = Grand theft auto
- MVC/TC = Motor vehicle collision/Traffic collision
- OD = Overdose
- OIS = Officer involved shooting
- PR/RP = Person reporting/Reporting person
- RA = Rescue ambulance
- RD = Reporting district
- RTO = Radio telephone operator (dispatcher)

"1200 block" = approximate location on a street
"cross of X and Y" or "X/Y" = intersection of two streets

IMPORTANT RULES:
- Extract any incident where you can identify BOTH a location AND an incident type. This includes new dispatches, active incidents, ongoing situations, and incidents mentioned alongside clearances or status updates.
- Only skip transcriptions that are PURELY radio chatter with no incident info: simple acknowledgments ("copy", "10-4"), radio checks, or unintelligible audio. Do NOT skip clearances or status updates that mention an incident type and location (e.g., "Code 4 on 417 at Daisy and Anna" contains a real incident).
- Use full names for crime types ("Robbery" not "211", "Burglary" not "459", "Battery" not "242"). Radio protocol codes like "Code 3" and unit designators like "9-Adam-45" are fine as-is.
- The location must include at minimum a street name with a cross street, block number, or address number. Examples of acceptable: "6262 Van Nuys Blvd", "Devonshire and Etiwanda", "Van Nuys Blvd near Ventura". NOT acceptable: a single street name like "Washington" or a vague description like "downtown".
- For incidentType: use a specific type when possible (e.g., "Burglary", "Traffic Collision", "Domestic Violence"). If the exact type is unclear but an incident clearly occurred, use "Dispatch Call" or "Investigation". Never use "Unknown", "Miscellaneous", or long descriptions.
- For timestamp: always output exactly the string "now". Do not attempt to parse any time from the audio.

You must respond with JSON. If the transcription contains an incident with a clear location and type, respond with:
{"actionable": true, "location": "...", "incidentType": "...", "timestamp": "now"}

Otherwise respond with:
{"actionable": false}`;

/**
 * Sends transcription to Ollama to extract structured incident data.
 * Uses JSON format mode for structured output.
 * Returns null if no actionable dispatch was found.
 */
export async function extractIncident(
  transcription: Transcription,
  priorContext: string[] = []
): Promise<ExtractedIncident | null> {
  try {
    const result = await withRetry(
      () => callOllama(transcription.text, priorContext),
      3,
      2000
    );
    return result;
  } catch (err) {
    logger.error("Extraction failed after retries", err);
    return null;
  }
}

async function callOllama(
  text: string,
  priorContext: string[]
): Promise<ExtractedIncident | null> {
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(priorContext.length > 0
          ? [
              {
                role: "user" as const,
                content: `Recent radio traffic. If the current transcription is missing a location or incident type, you MAY combine information from these previous chunks to fill in the gap. For example, if a previous chunk mentioned "459 burglary" and the current chunk says "at Devonshire and Etiwanda", combine them into one incident.\n\n${priorContext.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
              },
              {
                role: "assistant" as const,
                content: "I'll use this context and combine information across chunks if needed.",
              },
            ]
          : []),
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
    timestamp,
    rawTranscription: text,
  };
}
