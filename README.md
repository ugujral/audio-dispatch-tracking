# Dispatch Tracker

Real-time emergency dispatch tracker that listens to Broadcastify radio streams, transcribes audio with Whisper, extracts structured incident data using a local LLM (Ollama), and displays incidents on a live map.

Everything runs locally — no paid APIs required.

## How It Works

```
Broadcastify Stream → ffmpeg (10s WAV chunks) → Whisper (transcription) → Ollama (extraction) → Geocoding → Live Map
```

1. **ffmpeg** captures audio from a Broadcastify stream and segments it into 10-second WAV files
2. **Whisper** transcribes each WAV file to text
3. **Ollama** (Llama 3.1 8B) parses the transcription and extracts structured incident data (location, type, units dispatched)
4. **Nominatim** (OpenStreetMap) geocodes the location to lat/lng coordinates
5. The incident appears on a **Leaflet map** in your browser via Server-Sent Events

## Prerequisites

- **macOS** (tested on Apple Silicon)
- **Node.js** 18+
- **Homebrew**

## Setup

### 1. Install system dependencies

```bash
brew install ffmpeg ollama python
pip3 install openai-whisper
```

### 2. Start Ollama and pull the model

```bash
brew services start ollama
ollama pull llama3.1:8b
```

This downloads ~4.9GB. The model runs well on any Apple Silicon Mac with 16GB+ RAM.

### 3. Find a Broadcastify stream URL

1. Go to [broadcastify.com/listen](https://www.broadcastify.com/listen/)
2. Browse by state and county, or search for a city
3. Pick a fire/EMS/police feed
4. The stream URL format is `https://broadcastify.cdnstream1.com/FEED_ID` — you can find the feed ID in the web player URL (e.g., `broadcastify.com/webPlayer/24051` → feed ID is `24051`)

### 4. Install npm dependencies

```bash
npm install
```

### 5. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
# Required — your Broadcastify stream URL
STREAM_URL=https://broadcastify.cdnstream1.com/24051

# Match these to your stream's city for accurate geocoding
GEOCODE_CITY=Los Angeles
GEOCODE_STATE=CA

# Set map center to your city's coordinates
MAP_CENTER_LAT=34.0522
MAP_CENTER_LNG=-118.2437
```

All other settings have sensible defaults. See `.env.example` for the full list.

### 6. Test the pipeline

Test extraction and geocoding without a live stream:

```bash
npm run test-pipeline -- --text "Engine 12, Ladder 5, respond to 1200 block of Main Street for a structure fire"
```

You should see:

```
--- Extracted Incident ---
  Type:     Structure Fire
  Location: 1200 block of Main Street
  Units:    Engine 12, Ladder 5
  Lat:      33.99...
  Lng:      -118.47...
```

### 7. Run the app

```bash
npm run dev
```

Open **http://localhost:3000** in your browser. The map will center on your configured city. As dispatch audio comes in, incidents appear as colored dots (red = fire, blue = medical, yellow = traffic, orange = alarm, green = other).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | Yes | — | Broadcastify stream URL |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | No | `llama3.1:8b` | Ollama model to use |
| `WHISPER_MODEL` | No | `base.en` | Whisper model size (`tiny.en`, `base.en`, `small.en`, `medium.en`) |
| `WHISPER_PATH` | No | `whisper` | Path to whisper binary |
| `GEOCODE_CITY` | No | — | City for geocoding disambiguation |
| `GEOCODE_STATE` | No | — | State for geocoding disambiguation |
| `GEOCODE_COUNTRY` | No | `US` | Country for geocoding |
| `PORT` | No | `3000` | Web server port |
| `MAP_CENTER_LAT` | No | `34.0522` | Map center latitude |
| `MAP_CENTER_LNG` | No | `-118.2437` | Map center longitude |
| `MAP_ZOOM` | No | `12` | Map zoom level |
| `AD_SKIP_SECONDS` | No | `30` | Seconds to skip at stream start (Broadcastify ads). Set to `0` to disable |

## Whisper Model Selection

| Model | Size | Speed | Best for |
|-------|------|-------|----------|
| `tiny.en` | 40MB | Fastest | Quick testing |
| `base.en` | 140MB | Fast | Clear audio streams |
| `small.en` | 460MB | Moderate | Noisy dispatch audio (recommended) |
| `medium.en` | 1.5GB | Slow | Maximum accuracy |

Set via `WHISPER_MODEL` in `.env`. The model downloads automatically on first use.

## Troubleshooting

**"whisper: command not found"**
Find the install path: `python3 -c "import shutil; print(shutil.which('whisper'))"`
Then set `WHISPER_PATH` in `.env` to the full path.

**"Ollama request failed: 404" or connection refused**
Make sure Ollama is running: `brew services start ollama` or `ollama serve`.
Verify the model is pulled: `ollama list` should show `llama3.1:8b`.

**No incidents appearing on the map**
- Check the terminal logs — blank audio and non-dispatch chatter are silently skipped (this is normal)
- Active dispatch feeds may have long quiet periods
- Try a busier feed (large city fire/EMS feeds tend to have more activity)

**Stream disconnects frequently**
The app auto-reconnects after 30 seconds. Broadcastify streams can be unstable — this is expected behavior.
