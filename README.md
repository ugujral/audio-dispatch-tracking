# Dispatch Tracker

Real-time emergency dispatch tracker that listens to Broadcastify radio streams, transcribes audio with faster-whisper, extracts structured incident data using a local LLM (Ollama), and displays incidents on a live map.

Everything runs locally — no paid APIs required.

## How It Works

```
Broadcastify Stream → ffmpeg (audio filtering + 10s WAV chunks)
  → VAD silence detection → faster-whisper (transcription)
  → hallucination filter → Ollama (extraction with conversation history)
  → Geocoding → Live Map
```

1. **ffmpeg** captures audio, applies noise filters (highpass, lowpass, loudnorm), and segments into 10-second WAV files
2. **VAD** (Voice Activity Detection) checks each chunk for speech — silent chunks skip transcription entirely
3. **faster-whisper** transcribes WAV files to text (4x faster than OpenAI Whisper)
4. **Hallucination filter** blocks known Whisper false outputs ("Thank you very much", etc.)
5. **Ollama** (Llama 3.1 8B) parses the transcription with the last 5 chunks as context, extracting incident type and location
6. **Geocoding** (Nominatim or Google Maps) converts the address to coordinates
7. The incident appears on a **Leaflet map** in real-time via Server-Sent Events

The app starts idle — click **play** on the audio player to start processing. Click **pause** to stop.

## Prerequisites

- **macOS** (tested on Apple Silicon M4 Pro)
- **Node.js** 18+
- **Python 3**
- **Homebrew**

## Setup

### 1. Install system dependencies

```bash
brew install ffmpeg ollama
pip3 install faster-whisper
```

### 2. Start Ollama and pull the model

```bash
brew services start ollama
ollama pull llama3.1:8b
```

This downloads ~4.9GB. Runs well on any Apple Silicon Mac with 16GB+ RAM.

### 3. Find a Broadcastify stream URL

1. Go to [broadcastify.com/listen](https://www.broadcastify.com/listen/)
2. Browse by state and county, or search for a city
3. The stream URL format is `https://broadcastify.cdnstream1.com/FEED_ID`
4. The feed ID is in the web player URL (e.g., `broadcastify.com/webPlayer/26569` → feed ID is `26569`)

The stream name is automatically fetched from Broadcastify.

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
STREAM_URL=https://broadcastify.cdnstream1.com/26569

# Match these to your stream's city for accurate geocoding
GEOCODE_CITY=Los Angeles
GEOCODE_STATE=CA

# Set map center to your city's coordinates
MAP_CENTER_LAT=34.1868
MAP_CENTER_LNG=-118.4451
```

All other settings have sensible defaults. See `.env.example` for the full list.

### 6. Test the pipeline

Test extraction and geocoding without a live stream:

```bash
npm run test-pipeline -- --text "2-Adam-45, respond to a 459 burglary at 6262 Van Nuys Blvd"
```

### 7. Run the app

```bash
npm run dev
```

Open **http://localhost:3000**. Click play to start listening and processing.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STREAM_URL` | Yes | — | Broadcastify stream URL |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | No | `llama3.1:8b` | Ollama model to use |
| `WHISPER_MODEL` | No | `medium.en` | Whisper model size |
| `WHISPER_PATH` | No | `scripts/transcribe.py` | Path to transcription wrapper |
| `GOOGLE_MAPS_API_KEY` | No | — | Google Maps API key for better geocoding (falls back to OpenStreetMap) |
| `GEOCODE_CITY` | No | — | City for geocoding disambiguation |
| `GEOCODE_STATE` | No | — | State for geocoding disambiguation |
| `GEOCODE_COUNTRY` | No | `US` | Country for geocoding |
| `PORT` | No | `3000` | Web server port |
| `MAP_CENTER_LAT` | No | `34.0522` | Map center latitude |
| `MAP_CENTER_LNG` | No | `-118.2437` | Map center longitude |
| `MAP_ZOOM` | No | `12` | Map zoom level |
| `AD_SKIP_SECONDS` | No | `30` | Seconds to skip at stream start (Broadcastify ads) |

## How the Extraction Works

The system prompt includes comprehensive LAPD terminology:
- Full LAPD phonetic alphabet (Adam, Boy, Charles...)
- 50+ California Penal Codes (187=Homicide, 211=Robbery, 459=Burglary...)
- Unit designator format (9-Adam-45 = Van Nuys two-officer patrol)
- Valley Bureau division numbers
- All operational codes (Code 1-99, Robert, Sam, Tom)
- Common abbreviations (ADW, BOLO, DV, GTA, etc.)

The LLM receives the last 5 transcription chunks as conversation context, so dispatches that span multiple audio segments can still be extracted.

## Incident Types on the Map

| Color | Category | Examples |
|-------|----------|----------|
| Red | Fire | Structure fire, brush fire, smoke |
| Blue | Medical | Cardiac arrest, overdose, injury |
| Yellow | Traffic | Vehicle collision, traffic accident |
| Orange | Alarm | Fire alarm, AFA |
| Green | Other | Burglary, robbery, disturbance, welfare check |

## Troubleshooting

**"faster-whisper not found"**
Make sure it's installed: `pip3 install faster-whisper`

**Ollama connection refused**
Start Ollama: `brew services start ollama`
Check model: `ollama list` should show `llama3.1:8b`

**No incidents appearing**
- Check terminal logs — silent chunks and chatter are intentionally skipped
- Try a busier feed (LAPD, FDNY feeds have more activity)
- Incidents need both a clear location AND incident type to be extracted

**Incidents in wrong location**
- Set `GEOCODE_CITY` and `GEOCODE_STATE` to match your feed's jurisdiction
- Add `GOOGLE_MAPS_API_KEY` for much better address matching
- Some addresses get mangled by Whisper — this is inherent to noisy radio audio
