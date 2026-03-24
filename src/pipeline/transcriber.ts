import { execFile } from "child_process";
import { promises as fs } from "fs";
import { RawChunk, Transcription } from "./types.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/**
 * Uses ffmpeg's silencedetect to check if a WAV chunk contains speech.
 * Returns true if the chunk is mostly silence (no speech detected).
 */
function isSilent(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "ffmpeg",
      [
        "-i", filePath,
        "-af", "silencedetect=noise=-30dB:d=0.5",
        "-f", "null", "-",
      ],
      { timeout: 10_000 },
      (_err, _stdout, stderr) => {
        // Count how many silence_end markers ffmpeg found
        const silenceEnds = (stderr.match(/silence_end/g) || []).length;
        const silenceStarts = (stderr.match(/silence_start/g) || []).length;
        // If silence covers most of the chunk (only 0-1 speech segments), treat as silent
        // A chunk with real speech will have multiple silence breaks
        const hasSpeech = silenceEnds > 0 && silenceStarts !== silenceEnds;
        // Also check: if there's a silence_start but no silence_end, the entire chunk is silent
        const allSilent = stderr.includes("silence_start") && !stderr.includes("silence_end");
        resolve(allSilent || !stderr.includes("silence_end"));
      }
    );
  });
}

const BLANK_PATTERNS = [
  /\[BLANK_AUDIO\]/i,
  /^\s*$/,
  /\(silence\)/i,
  /^\.+$/,
  /you$/i, // Whisper hallucination on silence
];

// Known Whisper hallucinations on silence/noise — these are not real speech
const HALLUCINATION_PHRASES = [
  "thank you",
  "thank you very much",
  "thank you for watching",
  "thank you for listening",
  "thanks for watching",
  "i love you",
  "goodbye",
  "see you next time",
  "subscribe",
  "like and subscribe",
  "please subscribe",
  "the end",
  "beep",
  "beep beep",
  "roger",
  "definitely",
  "liftoff",
  "almost run",
  "topical status",
];

/**
 * Transcribes a WAV chunk using Whisper CLI.
 * Returns null if the audio is blank/noise.
 * Cleans up the WAV file after processing.
 */
export async function transcribe(
  chunk: RawChunk
): Promise<Transcription | null> {
  try {
    // VAD: skip chunks that are mostly silence (saves Whisper processing time)
    const silent = await isSilent(chunk.filePath);
    if (silent) {
      logger.debug(`Chunk ${chunk.sequenceNum}: silence detected (VAD), skipping Whisper`);
      return null;
    }

    const text = await runWhisper(chunk.filePath);

    if (!text || isBlank(text)) {
      logger.debug(`Chunk ${chunk.sequenceNum}: blank audio, skipping`);
      return null;
    }

    logger.info(`Chunk ${chunk.sequenceNum}: "${text.slice(0, 80)}..."`);
    return { text, chunk };
  } catch (err) {
    logger.error(`Transcription failed for chunk ${chunk.sequenceNum}`, err);
    return null;
  } finally {
    // Clean up WAV file and Whisper's .txt output to avoid disk bloat
    try {
      await fs.unlink(chunk.filePath);
    } catch {
      // ignore cleanup errors
    }
    // No .txt cleanup needed — faster-whisper outputs to stdout only
  }
}

function runWhisper(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [
        config.whisperPath,
        filePath,
        "--model", config.whisperModel,
      ],
      { timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Transcription failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function isBlank(text: string): boolean {
  // Strip Whisper timestamp markers like [00:00.000 --> 00:02.000]
  const stripped = text.replace(/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]\s*/g, "").trim();
  const lower = stripped.toLowerCase();
  return (
    stripped.length < 3 ||
    BLANK_PATTERNS.some((p) => p.test(stripped)) ||
    HALLUCINATION_PHRASES.some((phrase) => lower === phrase || lower === phrase + ".")
  );
}
