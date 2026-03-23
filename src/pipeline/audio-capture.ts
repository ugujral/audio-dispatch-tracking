import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { RawChunk } from "./types.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const CHUNK_DURATION = 10; // seconds
const RECONNECT_DELAY = 30_000; // ms

/**
 * Yields 10-second WAV file paths as ffmpeg captures them from the stream.
 * Automatically reconnects if the stream drops.
 */
export async function* captureAudioChunks(
  streamUrl: string
): AsyncGenerator<RawChunk> {
  const chunkDir = path.join(os.tmpdir(), "dispatch-chunks");
  await fs.mkdir(chunkDir, { recursive: true });

  let sequenceNum = 0;

  while (true) {
    try {
      yield* captureSession(streamUrl, chunkDir, sequenceNum);
    } catch (err) {
      logger.error("Stream capture failed, reconnecting...", err);
      await sleep(RECONNECT_DELAY);
    }
    // Increment sequence to avoid filename collisions after reconnect
    sequenceNum += 10000;
  }
}

async function* captureSession(
  streamUrl: string,
  chunkDir: string,
  startSeq: number
): AsyncGenerator<RawChunk> {
  const pattern = path.join(chunkDir, `chunk_${startSeq}_%04d.wav`);

  const ffmpeg = spawn("ffmpeg", [
    "-i", streamUrl,
    "-f", "segment",
    "-segment_time", String(CHUNK_DURATION),
    "-ac", "1",           // mono
    "-ar", "16000",       // 16kHz (Whisper expects this)
    "-acodec", "pcm_s16le",
    "-y",                 // overwrite
    pattern,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  logger.info(`ffmpeg started (PID ${ffmpeg.pid}), capturing from ${streamUrl}`);

  // Track stderr for debugging
  let stderrBuf = "";
  ffmpeg.stderr?.on("data", (data: Buffer) => {
    stderrBuf = data.toString().slice(-500); // keep last 500 chars
  });

  // Watch for new WAV files by polling
  const seen = new Set<string>();
  const exitPromise = onExit(ffmpeg);
  let chunkIndex = 0;
  const chunksToSkip = Math.ceil(config.adSkipSeconds / CHUNK_DURATION);
  if (chunksToSkip > 0) {
    logger.info(`Skipping first ${chunksToSkip} chunks (${config.adSkipSeconds}s ad period)`);
  }

  try {
    while (true) {
      // Check if ffmpeg has exited
      const exited = await Promise.race([
        exitPromise.then(() => true as const),
        sleep(2000).then(() => false as const),
      ]);

      // Scan directory for new chunk files
      const files = (await fs.readdir(chunkDir))
        .filter((f) => f.startsWith(`chunk_${startSeq}_`) && f.endsWith(".wav"))
        .sort();

      for (const file of files) {
        if (seen.has(file)) continue;

        const filePath = path.join(chunkDir, file);

        // Wait for the file to be fully written (next chunk means this one is done)
        // We yield the previous file only after a newer one appears
        const stat = await fs.stat(filePath);
        if (stat.size < 1000) continue; // too small, still being written

        seen.add(file);

        // Skip initial chunks during ad period
        if (chunkIndex < chunksToSkip) {
          logger.info(`Skipping ad chunk ${chunkIndex + 1}/${chunksToSkip}: ${file}`);
          chunkIndex++;
          try {
            await fs.unlink(filePath);
          } catch {
            // ignore cleanup errors
          }
          continue;
        }

        yield {
          filePath,
          startTime: new Date(Date.now() - CHUNK_DURATION * 1000),
          sequenceNum: startSeq + chunkIndex++,
        };
      }

      if (exited) {
        logger.warn("ffmpeg exited. Last stderr:", stderrBuf.trim());
        break;
      }
    }
  } finally {
    // Clean up ffmpeg if still running
    if (ffmpeg.exitCode === null) {
      ffmpeg.kill("SIGTERM");
    }
  }
}

function onExit(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    proc.on("exit", (code) => resolve(code));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
