import { IncidentStore } from "./store/incident-store.js";
import { PipelineController } from "./pipeline/pipeline-controller.js";
import { startServer } from "./server/app.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting Dispatch Tracker");

  const store = new IncidentStore();
  const pipeline = new PipelineController(store);

  // Start the web server (map frontend + SSE + pipeline control)
  startServer(store, pipeline);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await pipeline.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("Ready. Click play in the browser to start the pipeline.");
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
