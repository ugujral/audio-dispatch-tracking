import { EventEmitter } from "events";
import { captureAudioChunks } from "./audio-capture.js";
import { transcribe } from "./transcriber.js";
import { extractIncident } from "./extractor.js";
import { geocodeIncident } from "./geocoder.js";
import { IncidentStore } from "../store/incident-store.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export type PipelineState = "idle" | "processing";

export class PipelineController extends EventEmitter {
  private state: PipelineState = "idle";
  private abortController: AbortController | null = null;
  private runPromise: Promise<void> | null = null;

  constructor(private store: IncidentStore) {
    super();
  }

  getState(): PipelineState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === "processing") return;
    this.abortController = new AbortController();
    this.setState("processing");
    this.runPromise = this.run(this.abortController.signal);
    this.runPromise.catch((err) => {
      logger.error("Pipeline run error", err);
      this.setState("idle");
    });
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    this.abortController?.abort();
    await this.runPromise;
    this.runPromise = null;
    this.abortController = null;
    this.setState("idle");
  }

  private setState(s: PipelineState): void {
    this.state = s;
    this.emit("state-change", s);
  }

  private async run(signal: AbortSignal): Promise<void> {
    logger.info("Pipeline started");

    for await (const chunk of captureAudioChunks(config.streamUrl, signal)) {
      if (signal.aborted) break;
      try {
        const transcription = await transcribe(chunk);
        if (!transcription) continue;

        const extracted = await extractIncident(transcription);
        if (!extracted) continue;

        let geocoded = await geocodeIncident(extracted);
        if (!geocoded) {
          // Use map center as fallback so the incident still appears in the sidebar
          logger.warn(
            `Could not geocode "${extracted.location}" — using map center as fallback`
          );
          geocoded = {
            ...extracted,
            lat: config.mapCenterLat,
            lng: config.mapCenterLng,
          };
        }

        const stored = this.store.addIncident(geocoded);
        logger.info(
          `New incident: ${stored.incidentType} at ${stored.location} (${stored.lat}, ${stored.lng})`
        );
      } catch (err) {
        logger.error(`Pipeline error on chunk ${chunk.sequenceNum}`, err);
      }
    }

    logger.info("Pipeline stopped");
  }
}
