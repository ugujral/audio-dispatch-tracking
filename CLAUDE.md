# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Real-time emergency dispatch tracker: captures Broadcastify radio streams → transcribes with faster-whisper → extracts structured incident data via Ollama (local LLM) with conversation history → geocodes locations → displays on a live Leaflet map via SSE. Runs entirely locally with no paid APIs.

## Commands

```bash
npm run dev          # Start with hot-reload (tsx watch)
npm run start        # Start without watch
npm run test-pipeline -- <path-to-wav>                          # Test pipeline with a WAV file
npm run test-pipeline -- --text "Engine 12, respond to 1200 Main St for a structure fire"  # Test with raw text (skips Whisper)
```

Ollama must be running before starting: `ollama serve` (or `brew services start ollama`).

## External Dependencies

System tools (not npm packages):
- **ffmpeg** — captures audio, segments into 10s WAV files, applies audio filters (highpass, lowpass, loudnorm)
- **faster-whisper** — Python library for transcription (4x faster than OpenAI Whisper). Called via `scripts/transcribe.py` wrapper
- **Ollama** — runs llama3.1:8b locally for structured incident extraction via HTTP API on port 11434

## Architecture

The app starts idle. When the user clicks play in the browser, the `PipelineController` starts the audio capture and processing pipeline. Clicking pause stops it.

### Pipeline stages (in `src/pipeline/pipeline-controller.ts`)

`captureAudioChunks` (async generator, yields WAV files via ffmpeg) → VAD silence detection (ffmpeg silencedetect) → `transcribe` (faster-whisper) → hallucination filter → `extractIncident` (Ollama with conversation history) → `geocodeIncident` (Nominatim or Google Maps) → `IncidentStore.addIncident`

### Key design patterns

- **Play/pause control** (`src/pipeline/pipeline-controller.ts`): `PipelineController` manages start/stop via `AbortController`. Frontend audio player play/pause events trigger `POST /api/stream/start` and `/api/stream/stop`.
- **Conversation history**: The last 5 transcriptions are passed as context to Ollama, so dispatches split across chunks can still be extracted.
- **Audio preprocessing** (`src/pipeline/audio-capture.ts`): ffmpeg applies `highpass=300Hz`, `lowpass=3000Hz`, and `loudnorm` filters to clean radio noise before writing chunks.
- **VAD + hallucination filtering** (`src/pipeline/transcriber.ts`): ffmpeg `silencedetect` skips silent chunks before calling Whisper. Known hallucination phrases ("Thank you very much", etc.) are blocked.
- **LAPD-specific extraction** (`src/pipeline/extractor.ts`): System prompt includes full LAPD phonetic alphabet, 50+ California Penal Codes, unit designators, division numbers, and operational codes.
- **Ad skipping** (`src/pipeline/audio-capture.ts`): First N chunks skipped on each connection (configurable via `AD_SKIP_SECONDS`, default 30).
- **Intersection geocoding** (`src/pipeline/geocoder.ts`): Falls back to geocoding each street separately with distance guard (rejects averages >10km apart). Appends "Street" suffix to bare names. Falls back to map center if all geocoding fails.
- **Auto-fetch stream name** (`src/config.ts`): Extracts feed ID from Broadcastify URL and scrapes the feed name from the web player page.
- **Incident store** (`src/store/incident-store.ts`): Capped at 1000 incidents, supports delete via API. EventEmitter broadcasts new/removed incidents to SSE clients.

### Frontend

Vanilla JS + Leaflet map in `public/`. Audio player with play/pause controls the backend pipeline. Pipeline status indicator (Idle/Processing) pulses green when active. Incidents can be deleted from the sidebar. Stream name auto-displayed.

### API routes (in `src/server/app.ts`)

- `GET /api/incidents` — all stored incidents
- `DELETE /api/incidents/:id` — delete an incident
- `GET /api/config` — map center/zoom/stream settings
- `POST /api/stream/start` — start pipeline
- `POST /api/stream/stop` — stop pipeline
- `GET /api/stream/status` — pipeline state
- `GET /api/incidents/stream` — SSE stream (incidents + pipeline state + removals)

## Configuration

All config in `.env` (see `.env.example`). Only `STREAM_URL` is required. Ollama must be running locally. Optional `GOOGLE_MAPS_API_KEY` for better geocoding. `GEOCODE_CITY`/`GEOCODE_STATE` appended to locations for disambiguation.

## TypeScript

ESM modules (`"type": "module"`). All imports use `.js` extensions. Target ES2022, module resolution `nodenext`. Run via `tsx`.
