# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Real-time emergency dispatch tracker: captures Broadcastify radio streams → transcribes with Whisper → extracts structured incident data via Ollama (local LLM) → geocodes locations → displays on a live Leaflet map via SSE. Runs entirely locally with no paid APIs.

## Commands

```bash
npm run dev          # Start with hot-reload (tsx watch)
npm run start        # Start without watch
npm run test-pipeline -- <path-to-wav>                          # Test pipeline with a WAV file
npm run test-pipeline -- --text "Engine 12, respond to 1200 Main St for a structure fire"  # Test with raw text (skips Whisper)
```

Ollama must be running before starting: `ollama serve` (or `brew services start ollama`).

## External Dependencies

Three system tools must be installed (not npm packages):
- **ffmpeg** — captures and segments audio from the stream into 10-second WAV files
- **whisper** CLI (OpenAI Whisper) — transcribes WAV files to text, invoked as a child process
- **Ollama** — runs a local LLM (llama3.1:8b) for structured incident extraction via HTTP API on port 11434

## Architecture

The app is a single long-running Node process (`src/index.ts`) that runs two things concurrently:
1. An Express web server serving a static frontend + REST/SSE APIs
2. An async generator pipeline loop that continuously processes audio

### Pipeline stages (sequential, in `src/index.ts` main loop)

`captureAudioChunks` (async generator, yields WAV files via ffmpeg) → `transcribe` (Whisper CLI) → `extractIncident` (Ollama local LLM) → `geocodeIncident` (Nominatim/OpenStreetMap) → `IncidentStore.addIncident`

Each stage returns `null` to skip non-actionable audio; the main loop `continue`s on null. Errors in a single chunk are caught and logged without stopping the pipeline.

### Key design patterns

- **Ad skipping** (`src/pipeline/audio-capture.ts`): Broadcastify plays 15-30s of ads on each connection. The first N chunks are skipped and deleted (configurable via `AD_SKIP_SECONDS`, default 30). Applies on every reconnection.
- **Ollama extraction uses JSON format mode** (`src/pipeline/extractor.ts`): Calls Ollama's `/api/chat` endpoint with `format: "json"`. The model returns `{"actionable": false}` for non-dispatch audio, or a full incident object.
- **IncidentStore is an EventEmitter** (`src/store/incident-store.ts`): `addIncident` emits `"new-incident"`, which SSEManager listens to for broadcasting to connected clients.
- **Audio capture uses polling** (`src/pipeline/audio-capture.ts`): ffmpeg writes segmented WAV files to a temp directory; the capture loop polls for new files every 2 seconds. Auto-reconnects on stream drops with a 30-second delay.
- **Retry with exponential backoff** (`src/utils/retry.ts`): `withRetry(fn, maxRetries, baseDelayMs)` is used for Ollama calls and geocoding.

### Frontend

Vanilla JS + Leaflet map in `public/`. Fetches initial incidents via `GET /api/incidents`, then subscribes to `GET /api/incidents/stream` (SSE) for real-time updates. Map center/zoom configured server-side via `GET /api/config`.

### API routes (in `src/server/app.ts`)

- `GET /api/incidents` — all stored incidents
- `GET /api/config` — map center/zoom settings
- `GET /api/incidents/stream` — SSE stream of new incidents

## Configuration

All config is in `.env` (see `.env.example`). Only `STREAM_URL` is required. Ollama must be running locally. The `GEOCODE_CITY`/`GEOCODE_STATE` variables are appended to dispatch locations for geocoding disambiguation.

## TypeScript

ESM modules (`"type": "module"` in package.json). All imports use `.js` extensions. Target ES2022, module resolution `nodenext`. Run via `tsx` (no separate build step needed for dev).
