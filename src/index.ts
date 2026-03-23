import { config } from "./config.js";
import { captureAudioChunks } from "./pipeline/audio-capture.js";
import { transcribe } from "./pipeline/transcriber.js";
import { extractIncident } from "./pipeline/extractor.js";
import { geocodeIncident } from "./pipeline/geocoder.js";
import { IncidentStore } from "./store/incident-store.js";
import { startServer } from "./server/app.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting Dispatch Tracker");
  logger.info(`Stream URL: ${config.streamUrl}`);
  logger.info(`Whisper model: ${config.whisperModel}`);

  const store = new IncidentStore();

  // Start the web server (map frontend + SSE)
  startServer(store);

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Main pipeline loop: audio → transcribe → extract → geocode → store
  logger.info("Starting audio capture pipeline...");

  for await (const chunk of captureAudioChunks(config.streamUrl)) {
    try {
      // Stage 1: Transcribe audio chunk
      const transcription = await transcribe(chunk);
      if (!transcription) continue;

      // Stage 2: Extract incident data via Ollama
      const extracted = await extractIncident(transcription);
      if (!extracted) continue;

      // Stage 3: Geocode the location
      const geocoded = await geocodeIncident(extracted);
      if (!geocoded) {
        logger.warn(
          `Could not geocode "${extracted.location}" — incident skipped`
        );
        continue;
      }

      // Stage 4: Store and broadcast to map clients
      const stored = store.addIncident(geocoded);
      logger.info(
        `New incident: ${stored.incidentType} at ${stored.location} (${stored.lat}, ${stored.lng})`
      );
    } catch (err) {
      logger.error(`Pipeline error on chunk ${chunk.sequenceNum}`, err);
      // Continue to next chunk — don't let one failure stop the pipeline
    }
  }
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
