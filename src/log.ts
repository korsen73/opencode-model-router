// Structured routing log lines. Never logs keys/credentials.

import { appendLine, iso } from "./io.ts";
import type { RoutingLogEntry } from "./types.ts";

const LOG_FILE = "logs/routing.log";

export async function logRouting(entry: RoutingLogEntry): Promise<void> {
  const { timestamp, ...rest } = entry;
  const line = JSON.stringify({
    timestamp: timestamp ?? iso(),
    ...rest,
  });
  await appendLine(LOG_FILE, line);
}

/** Pure formatter for tests: builds the log line without writing. */
export function formatEntry(entry: RoutingLogEntry): string {
  const { timestamp, ...rest } = entry;
  return JSON.stringify({ timestamp: timestamp ?? iso(), ...rest });
}
