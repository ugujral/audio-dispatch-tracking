import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { GeocodedIncident, StoredIncident } from "../pipeline/types.js";

export class IncidentStore extends EventEmitter {
  private incidents: StoredIncident[] = [];

  addIncident(incident: GeocodedIncident): StoredIncident {
    const stored: StoredIncident = {
      ...incident,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.incidents.push(stored);
    this.emit("new-incident", stored);
    return stored;
  }

  getAll(): StoredIncident[] {
    return [...this.incidents];
  }

  getRecent(count: number = 50): StoredIncident[] {
    return this.incidents.slice(-count);
  }
}
