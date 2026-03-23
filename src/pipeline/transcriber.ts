import { execFile } from "child_process";
import { promises as fs } from "fs";
import { RawChunk, Transcription } from "./types.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const BLANK_PATTERNS = [
  /\[BLANK_AUDIO\]/i,
  /^\s*$/,
  /\(silence\)/i,
  /^\.+$/,
  /you$/i, // Whisper hallucination on silence
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
    // Clean up WAV file to avoid disk bloat
    try {
      await fs.unlink(chunk.filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

function runWhisper(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use execFile (not exec) to prevent shell injection
    execFile(
      config.whisperPath,
      [
        filePath,
        "--model", config.whisperModel,
        "--output_format", "txt",
        "--language", "en",
        "--output_dir", "/tmp",
      ],
      { timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Whisper failed: ${stderr || err.message}`));
          return;
        }
        // Whisper writes to a .txt file next to the output_dir
        // but also outputs to stdout in some versions
        resolve(stdout.trim());
      }
    );
  });
}

function isBlank(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length < 3 ||
    BLANK_PATTERNS.some((p) => p.test(trimmed))
  );
}
