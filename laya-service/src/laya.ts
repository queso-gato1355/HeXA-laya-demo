// Load Laya from a local bundle (never downloads) and pick an execution provider that actually works.
//
// LAYA_EP=auto tries the GPU EPs this OS ships in onnxruntime-node, then cpu (docs/env-notes.md):
//   win32       webgpu, dml   (dml loads but fails at run time on this model's Reshape node -> probe call)
//   linux x64   cuda, webgpu
//   other       (none)
// Every GPU candidate must survive a probe systemOne() call; otherwise the next one is tried.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Laya } from "@receptron/laya";
import { resolveFromRoot } from "./env";

const REQUIRED_FILES = ["laya.onnx", "laya_config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"];

export class ModelMissingError extends Error {}

export interface LoadedLaya {
  laya: Laya;
  ep: string;
  requested: string[];
  fallback: boolean;
  quantized: boolean;
  modelDir: string;
  loadMs: number;
}

export function gpuCandidates(platform = process.platform, arch = process.arch): string[] {
  if (platform === "win32") return ["webgpu", "dml"];
  if (platform === "linux" && arch === "x64") return ["cuda", "webgpu"];
  return [];
}

export function epPlan(setting: string | undefined): string[] {
  const s = (setting ?? "auto").toLowerCase();
  if (s === "cpu") return ["cpu"];
  if (s === "auto") return [...gpuCandidates(), "cpu"];
  return [s, "cpu"];
}

export function checkBundle(modelDir: string): void {
  const missing = REQUIRED_FILES.filter((f) => !existsSync(path.join(modelDir, f)));
  if (missing.length) {
    throw new ModelMissingError(
      `Laya 모델 번들이 없습니다 (${modelDir}: ${missing.join(", ")}). pnpm fetch-models를 먼저 실행하세요.`,
    );
  }
}

export function isQuantized(modelDir: string): boolean {
  const marker = path.join(modelDir, "quantization.json");
  if (!existsSync(marker)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(marker, "utf8")).quantized);
  } catch {
    return false;
  }
}

const PROBE_STATE = {
  robot: { speed_mps: 0.8, heading_deg: 90 },
  route: { next_maneuver: "straight", dist_to_maneuver_m: 20, crossing_now: false, off_route_m: 0.5 },
  gps: { accuracy_m: 4 },
  free_space: { left: "open", center: "open", right: "open" },
  objects: [],
};
const PROBE_Q = { probe: { type: "noul" as const, instructions: "Is the path clear?" } };

export async function probe(laya: Laya): Promise<void> {
  await laya.systemOne(PROBE_STATE, PROBE_Q);
}

export async function loadLaya(opts: {
  modelDir?: string;
  ep?: string;
  threads?: number;
  log?: (msg: string) => void;
}): Promise<LoadedLaya> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const modelDir = resolveFromRoot(opts.modelDir ?? process.env.LAYA_MODEL_DIR ?? "./models/laya");
  checkBundle(modelDir);
  const plan = epPlan(opts.ep ?? process.env.LAYA_EP);
  const threads = opts.threads ?? (Number(process.env.LAYA_INTRA_THREADS) || 8);
  const t0 = performance.now();
  let lastErr: unknown;
  for (const ep of plan) {
    let laya: Laya | undefined;
    try {
      laya = await Laya.load({
        modelDir,
        executionProviders: [ep as never],
        sessionOptions: ep === "cpu" ? { intraOpNumThreads: threads } : {},
      });
      await probe(laya);
      const fallback = ep === "cpu" && plan[0] !== "cpu";
      if (fallback) log(`[laya] WARNING: GPU EP unavailable, running on CPU (${threads} threads)`);
      return {
        laya,
        ep,
        requested: plan,
        fallback,
        quantized: isQuantized(modelDir),
        modelDir,
        loadMs: Math.round(performance.now() - t0),
      };
    } catch (e) {
      lastErr = e;
      log(`[laya] EP ${ep} failed: ${String((e as Error).message ?? e).split("\n")[0].slice(0, 200)}`);
      await laya?.close().catch(() => undefined);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
