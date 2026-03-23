const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) || "info";
const minIdx = LEVELS.indexOf(MIN_LEVEL);

function log(level: Level, msg: string, extra?: unknown) {
  if (LEVELS.indexOf(level) < minIdx) return;
  const time = new Date().toISOString();
  const prefix = `[${time}] [${level.toUpperCase()}]`;
  if (extra !== undefined) {
    console.log(prefix, msg, extra);
  } else {
    console.log(prefix, msg);
  }
}

export const logger = {
  debug: (msg: string, extra?: unknown) => log("debug", msg, extra),
  info: (msg: string, extra?: unknown) => log("info", msg, extra),
  warn: (msg: string, extra?: unknown) => log("warn", msg, extra),
  error: (msg: string, extra?: unknown) => log("error", msg, extra),
};
