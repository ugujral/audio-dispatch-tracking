import { Response } from "express";
import { IncidentStore } from "../store/incident-store.js";
import { PipelineController } from "../pipeline/pipeline-controller.js";
import { StoredIncident } from "../pipeline/types.js";
import { logger } from "../utils/logger.js";

/**
 * Manages Server-Sent Events connections for real-time incident updates
 * and pipeline state changes.
 */
export class SSEManager {
  private clients = new Set<Response>();

  constructor(
    private store: IncidentStore,
    private pipeline: PipelineController
  ) {
    store.on("new-incident", (incident: StoredIncident) => {
      this.broadcast(incident);
    });

    pipeline.on("state-change", (state: string) => {
      this.broadcastState(state);
    });
  }

  /**
   * Registers a new SSE client connection.
   * Sets appropriate headers and sends initial keepalive + current pipeline state.
   */
  addClient(res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send initial keepalive
    res.write(": connected\n\n");

    // Send current pipeline state so client knows immediately
    res.write(
      `event: pipeline-status\ndata: ${JSON.stringify({ state: this.pipeline.getState() })}\n\n`
    );

    this.clients.add(res);
    logger.info(`SSE client connected (${this.clients.size} total)`);

    res.on("close", () => {
      this.clients.delete(res);
      logger.info(`SSE client disconnected (${this.clients.size} total)`);
    });
  }

  private broadcast(incident: StoredIncident): void {
    const data = `data: ${JSON.stringify(incident)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private broadcastState(state: string): void {
    const msg = `event: pipeline-status\ndata: ${JSON.stringify({ state })}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(msg);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
