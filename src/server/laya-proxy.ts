// Server-only helpers for the /api/laya/* proxy routes. Laya itself runs in laya-service
// (LAYA_ENDPOINT); Next.js never loads the model.
import piProfile from "@shared/pi-profile.json";

export const LAYA_ENDPOINT = (process.env.LAYA_ENDPOINT || "http://127.0.0.1:8787").replace(/\/+$/, "");

export function endpointIsLocal(endpoint = LAYA_ENDPOINT): boolean {
  try {
    const h = new URL(endpoint).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

export function decisionHz(): number {
  const v = Number(process.env.DECISION_HZ);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 4) : 1;
}

export const PI_PROFILE = piProfile as {
  source: string;
  measured: boolean;
  model: string;
  p50Ms: Record<string, number>;
  p95Ms: Record<string, number>;
  rates: Record<string, number>;
  maxHz: number;
};

export function forward(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  return fetch(`${LAYA_ENDPOINT}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}

// ---------------------------------------------------------------- Pi budget simulation
// On the Pi every call takes ~p50 and calls run one after another, so simulated delays must be
// serialized as well, not just added per request. globalThis keeps the queue across dev HMR.
const g = globalThis as unknown as { __piQueue?: Promise<unknown> };

export function piSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__piQueue ?? Promise.resolve();
  const run = prev.then(fn, fn);
  g.__piQueue = run.catch(() => undefined);
  return run;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
