/**
 * Test script: feeds a WAV file (or sample text) through the pipeline
 * without needing a live Broadcastify stream.
 *
 * Usage:
 *   npx tsx scripts/test-pipeline.ts <path-to-wav>
 *   npx tsx scripts/test-pipeline.ts --text "Engine 12, Ladder 5, respond to 1200 block of Main Street for a structure fire"
 */
import { transcribe } from "../src/pipeline/transcriber.js";
import { extractIncident } from "../src/pipeline/extractor.js";
import { geocodeIncident } from "../src/pipeline/geocoder.js";
import { RawChunk, Transcription } from "../src/pipeline/types.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  npx tsx scripts/test-pipeline.ts <path-to-wav>");
    console.log(
      '  npx tsx scripts/test-pipeline.ts --text "Engine 12, respond to 1200 Main St for a structure fire"'
    );
    process.exit(1);
  }

  let transcription: Transcription | null;

  if (args[0] === "--text") {
    // Skip whisper, use provided text directly
    const text = args.slice(1).join(" ");
    logger.info(`Using provided text: "${text}"`);
    transcription = {
      text,
      chunk: { filePath: "manual-input", startTime: new Date(), sequenceNum: 0 },
    };
  } else {
    // Transcribe the provided WAV file
    const wavPath = args[0];
    logger.info(`Transcribing: ${wavPath}`);
    const chunk: RawChunk = {
      filePath: wavPath,
      startTime: new Date(),
      sequenceNum: 0,
    };
    transcription = await transcribe(chunk);
  }

  if (!transcription) {
    logger.warn("Transcription was blank or failed");
    process.exit(0);
  }

  logger.info(`Transcription: "${transcription.text}"`);

  // Extract incident
  logger.info("Extracting incident data via Claude...");
  const extracted = await extractIncident(transcription);
  if (!extracted) {
    logger.warn("No actionable dispatch found");
    process.exit(0);
  }

  console.log("\n--- Extracted Incident ---");
  console.log(`  Type:     ${extracted.incidentType}`);
  console.log(`  Location: ${extracted.location}`);
  console.log(`  Time:     ${extracted.timestamp}`);

  // Geocode
  logger.info("Geocoding location...");
  const geocoded = await geocodeIncident(extracted);
  if (!geocoded) {
    logger.warn("Geocoding failed — could not resolve location");
    process.exit(0);
  }

  console.log(`  Lat:      ${geocoded.lat}`);
  console.log(`  Lng:      ${geocoded.lng}`);
  console.log("\nPipeline test complete.");
}

main().catch((err) => {
  logger.error("Test failed", err);
  process.exit(1);
});
