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
        "-af", "silencedetect=noise=-25dB:d=0.5",
        "-f", "null", "-",
      ],
      { timeout: 10_000 },
      (_err, _stdout, stderr) => {
        const silenceEnds = (stderr.match(/silence_end/g) || []).length;
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
  /you$/i,
];

// Short exact-match hallucinations
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

// Longer hallucination patterns — if the text CONTAINS any of these, it's fake
const HALLUCINATION_PATTERNS = [
  /thank you (so much )?for (watching|listening|being here)/i,
  /see you (in the )?next (time|video|episode)/i,
  /subscribe (to|and|for)/i,
  /like and subscribe/i,
  /been a long time since/i,
  /happy to have you/i,
  /we're very happy/i,
  /welcome (back )?to (the|my|our)/i,
  /that's it for today/i,
  /hope you enjoyed/i,
  /don't forget to/i,
  /hit the (bell|notification)/i,
  /leave a comment/i,
  /in (today's|this) (video|episode)/i,
  /make sure (to|you)/i,
  /if you (liked|enjoyed) this/i,
  /let me know (in the|what you)/i,
  /stay tuned/i,
  /catch you (later|next|in the)/i,
];

/**
 * Transcribes a WAV chunk using faster-whisper.
 * Returns null if the audio is blank/noise/hallucination.
 * Cleans up the WAV file after processing.
 */
export async function transcribe(
  chunk: RawChunk
): Promise<Transcription | null> {
  try {
    // VAD: skip chunks that are mostly silence
    const silent = await isSilent(chunk.filePath);
    if (silent) {
      logger.debug(`Chunk ${chunk.sequenceNum}: silence detected (VAD), skipping`);
      return null;
    }

    const text = await runWhisper(chunk.filePath);

    if (!text || isBlank(text)) {
      logger.debug(`Chunk ${chunk.sequenceNum}: blank/hallucination, skipping`);
      return null;
    }

    logger.info(`Chunk ${chunk.sequenceNum}: "${text.slice(0, 80)}..."`);
    return { text, chunk };
  } catch (err) {
    logger.error(`Transcription failed for chunk ${chunk.sequenceNum}`, err);
    return null;
  } finally {
    try {
      await fs.unlink(chunk.filePath);
    } catch {
      // ignore cleanup errors
    }
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
  // Strip Whisper timestamp markers
  const stripped = text.replace(/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]\s*/g, "").trim();
  const lower = stripped.toLowerCase();

  // Too short
  if (stripped.length < 3) return true;

  // Matches blank pattern
  if (BLANK_PATTERNS.some((p) => p.test(stripped))) return true;

  // Exact match hallucination
  if (HALLUCINATION_PHRASES.some((phrase) => lower === phrase || lower === phrase + ".")) return true;

  // Contains hallucination pattern (YouTube/podcast style)
  if (HALLUCINATION_PATTERNS.some((p) => p.test(stripped))) return true;

  return false;
}
