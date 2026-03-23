import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { GeocodedIncident, StoredIncident } from "../pipeline/types.js";

const MAX_INCIDENTS = 1000;

export class IncidentStore extends EventEmitter {
  private incidents: StoredIncident[] = [];

  addIncident(incident: GeocodedIncident): StoredIncident {
    const stored: StoredIncident = {
      ...incident,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.incidents.push(stored);
    if (this.incidents.length > MAX_INCIDENTS) {
      this.incidents = this.incidents.slice(-MAX_INCIDENTS);
    }
    this.emit("new-incident", stored);
    return stored;
  }

  removeIncident(id: string): boolean {
    const idx = this.incidents.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.incidents.splice(idx, 1);
    this.emit("remove-incident", id);
    return true;
  }

  getAll(): StoredIncident[] {
    return [...this.incidents];
  }

}
