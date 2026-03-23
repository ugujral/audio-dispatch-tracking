import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { IncidentStore } from "../store/incident-store.js";
import { PipelineController } from "../pipeline/pipeline-controller.js";
import { SSEManager } from "./sse.js";
import { config, fetchStreamName } from "../config.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startServer(
  store: IncidentStore,
  pipeline: PipelineController
): void {
  const app = express();
  const sse = new SSEManager(store, pipeline);

  // Auto-fetch stream name from Broadcastify if not set
  if (!config.streamName) {
    fetchStreamName(config.streamUrl).then((name) => {
      if (name) {
        config.streamName = name;
        logger.info(`Stream name: ${name}`);
      }
    });
  }

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, "../../public")));

  // REST: get all incidents
  app.get("/api/incidents", (_req, res) => {
    res.json(store.getAll());
  });

  // REST: delete an incident
  app.delete("/api/incidents/:id", (req, res) => {
    const removed = store.removeIncident(req.params.id);
    if (removed) {
      res.json({ deleted: true });
    } else {
      res.status(404).json({ error: "Incident not found" });
    }
  });

  // REST: get map config (so frontend knows where to center)
  app.get("/api/config", (_req, res) => {
    res.json({
      mapCenterLat: config.mapCenterLat,
      mapCenterLng: config.mapCenterLng,
      mapZoom: config.mapZoom,
      streamUrl: config.streamUrl,
      streamName: config.streamName,
    });
  });

  // Pipeline control
  app.post("/api/stream/start", async (_req, res) => {
    await pipeline.start();
    res.json({ state: pipeline.getState() });
  });

  app.post("/api/stream/stop", async (_req, res) => {
    await pipeline.stop();
    res.json({ state: pipeline.getState() });
  });

  app.get("/api/stream/status", (_req, res) => {
    res.json({ state: pipeline.getState() });
  });

  // SSE: real-time incident stream
  app.get("/api/incidents/stream", (_req, res) => {
    sse.addClient(res);
  });

  app.listen(config.port, () => {
    logger.info(`Server running at http://localhost:${config.port}`);
  });
}
