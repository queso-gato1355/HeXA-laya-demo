// laya-service: standalone Laya decision server (PC or the rover's Raspberry Pi 5).
//
//   POST /criteria/:name   { clipId, t, state }  -> CriterionResponse   (one criterion = one systemOne call)
//   GET  /status                                   -> LayaStatus
//   POST /warmup                                   -> one dummy call
//   GET  /metrics?after=<epoch ms>                 -> CPU / RAM / GPU of this machine + this process (1 Hz history)
//
// One model instance does not get faster with concurrent calls, so every systemOne() goes through a
// FIFO mutex. Results are cached by (clipId, t rounded to 0.5 s, criterion).
import http from "node:http";
import type { Laya } from "@receptron/laya";
import { getCriterion, toDisplay } from "../../shared/criteria/index";
import type { Answer } from "../../shared/laya-types";
import { MetricsSampler, SAMPLE_MS } from "../../shared/metrics";
import { CriterionRequestSchema, type CriterionResponse, type LayaStatus } from "../../shared/state";
import { loadEnvFile } from "./env";
import { type LoadedLaya, ModelMissingError, loadLaya } from "./laya";

loadEnvFile();

const PORT = Number(process.env.LAYA_PORT) || 8787;
const HOST = process.env.LAYA_HOST || "127.0.0.1";
const RSS_WARN_MB = 3000;
const CACHE_MAX = 5000;
const metrics = new MetricsSampler("laya-service");

let loaded: LoadedLaya | null = null;
let status: LayaStatus = { state: "loading", message: "모델 로딩 중", platform: `${process.platform}-${process.arch}` };

// ------------------------------------------------------------------ mutex (FIFO)
let tail: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

// ------------------------------------------------------------------ cache
const cache = new Map<string, CriterionResponse>();
function cacheSet(key: string, v: CriterionResponse) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, v);
}

const rssMB = () => Math.round(process.memoryUsage().rss / 1e6);

function currentStatus(): LayaStatus {
  const rss = rssMB();
  return { ...status, rssMB: rss, rssWarn: rss > RSS_WARN_MB };
}

// ------------------------------------------------------------------ load
async function init() {
  try {
    loaded = await loadLaya({ log: (m) => console.log(m) });
    status = {
      state: "ready",
      ep: loaded.ep,
      epRequested: loaded.requested,
      epFallback: loaded.fallback,
      quantized: loaded.quantized,
      modelDir: loaded.modelDir,
      loadMs: loaded.loadMs,
      platform: `${process.platform}-${process.arch}`,
    };
    console.log(`[laya] ready: ep=${loaded.ep} quantized=${loaded.quantized} load=${loaded.loadMs}ms rss=${rssMB()}MB`);
    if (rssMB() > RSS_WARN_MB) console.warn(`[laya] WARNING: RSS ${rssMB()} MB exceeds the Pi budget of ${RSS_WARN_MB} MB`);
  } catch (e) {
    const missing = e instanceof ModelMissingError;
    status = { state: missing ? "missing" : "error", message: (e as Error).message, platform: status.platform };
    console.error(`[laya] ${missing ? "model missing" : "load failed"}: ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------ handlers
async function runCriterion(name: string, body: unknown): Promise<[number, unknown]> {
  const def = getCriterion(name);
  if (!def) return [404, { error: `unknown criterion: ${name}` }];
  const parsed = CriterionRequestSchema.safeParse(body);
  if (!parsed.success) return [400, { error: "invalid request", issues: parsed.error.issues.slice(0, 5) }];
  if (!loaded) return [503, { error: status.message ?? "model not ready", status: currentStatus() }];
  const { clipId, t, state } = parsed.data;
  const key = `${clipId}|${(Math.round(t * 2) / 2).toFixed(1)}|${name}`;
  const hit = cache.get(key);
  if (hit) return [200, { ...hit, cached: true, latencyMs: 0, queueMs: 0 }];

  const laya: Laya = loaded.laya;
  const t0 = performance.now();
  let tStart = 0;
  const result = await serialize(async () => {
    tStart = performance.now();
    return laya.systemOne(state, { [name]: def.question });
  });
  const t1 = performance.now();
  const answer = result.answers[name] as Answer;
  const res: CriterionResponse = {
    criterion: name,
    type: def.question.type,
    answer,
    display: toDisplay(def, answer),
    latencyMs: Math.round(t1 - t0),
    computeMs: Math.round(t1 - tStart),
    queueMs: Math.round(tStart - t0),
    inputTokens: result.usage.input_tokens,
    cached: false,
    ep: loaded.ep,
  };
  cacheSet(key, res);
  return [200, res];
}

async function warmup(): Promise<[number, unknown]> {
  if (!loaded) return [503, { error: status.message ?? "model not ready" }];
  const laya = loaded.laya;
  const t0 = performance.now();
  const def = getCriterion("collision_risk")!;
  await serialize(() =>
    laya.systemOne(
      {
        robot: { speed_mps: 0.8, heading_deg: 90 },
        route: { next_maneuver: "straight", dist_to_maneuver_m: 20, crossing_now: false, off_route_m: 0.5 },
        gps: { accuracy_m: 4 },
        free_space: { left: "open", center: "open", right: "open" },
        objects: [],
      },
      { collision_risk: def.question },
    ),
  );
  return [200, { ok: true, ms: Math.round(performance.now() - t0) }];
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(s);
}

async function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/status") return send(res, 200, currentStatus());
    if (req.method === "POST" && url.pathname === "/warmup") return send(res, ...(await warmup()));
    if (req.method === "GET" && url.pathname === "/metrics") {
      return send(res, 200, { sampleMs: SAMPLE_MS, samples: metrics.since(Number(url.searchParams.get("after")) || undefined) });
    }
    const m = /^\/criteria\/([a-z_]+)$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
      return send(res, ...(await runCriterion(m[1], body)));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[laya] listening on http://${HOST}:${PORT}  (${process.platform}-${process.arch}, node ${process.version})`);
  void init();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    metrics.stop();
    void loaded?.laya.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
