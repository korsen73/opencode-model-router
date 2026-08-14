// Minimal filesystem + env helpers. Keeps modules simple and testable by
// allowing injection of a base directory and fetch.

import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Default router base directory. Overridable for tests via env ROUTER_DIR. */
export function routerDir(): string {
  return process.env.ROUTER_DIR ?? path.join(process.env.HOME ?? "", ".config/opencode/router");
}

export function dataPath(file: string): string {
  return path.join(routerDir(), file);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(dataPath(file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  const p = dataPath(file);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

export async function appendLine(file: string, line: string): Promise<void> {
  const p = dataPath(file);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, line + "\n", "utf8");
}

export function now(): number {
  return Date.now();
}

export function iso(): string {
  return new Date().toISOString();
}

/** Local-timezone YYYY-MM-DD key used for daily usage reset. */
export function localDayKey(offset?: { hour: number; minute: number }): string {
  const d = new Date();
  // shift so the "reset boundary" is at configured hour/minute local time
  const h = offset?.hour ?? 0;
  const m = offset?.minute ?? 0;
  const shifted = new Date(d.getTime() - (h * 60 + m) * 60000);
  return shifted.toISOString().slice(0, 10);
}

export function readEnv(name: string): string | undefined {
  return process.env[name];
}

/** Fisher-Yates unbiased shuffle (in place, returns same array). */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}
