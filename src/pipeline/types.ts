export interface RawChunk {
  filePath: string;
  startTime: Date;
  sequenceNum: number;
}

export interface Transcription {
  text: string;
  chunk: RawChunk;
}

export interface ExtractedIncident {
  location: string;
  incidentType: string;
  units: string[];
  timestamp: string;
  rawTranscription: string;
}

export interface GeocodedIncident extends ExtractedIncident {
  lat: number;
  lng: number;
}

export interface StoredIncident extends GeocodedIncident {
  id: string;
  createdAt: string;
}
