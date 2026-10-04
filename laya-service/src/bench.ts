// Laya latency benchmark (pnpm bench:laya). Every EP x model combination runs in its own child process
// so RSS and cold-start numbers are clean.
//
//   pnpm bench:laya                     PC: every GPU EP this OS offers + cpu, fp32 (+ int8 if present)
//                                       -> docs/bench.md, DECISION_HZ in .env.local.example
//   pnpm bench:laya --pi                Pi profile: cpu, 4 threads, fp32 + int8
//                                       -> docs/bench-pi.md + shared/pi-profile.json (source: measured)
//   pnpm bench:laya --pi-proxy          same as --pi but run on a non-Pi machine; the profile is marked as an
//                                       estimate scaled by --pi-slowdown (default 8)
//   options: --eps webgpu,cpu  --models laya,laya-int8  --threads 8  --n 20
//            --from-json docs/bench.results.json   re-render docs from saved raw results
// Measure on an idle machine: a game or video playback sharing the GPU/CPU inflates the numbers several-fold.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Laya } from "@receptron/laya";
import { CRITERIA } from "../../shared/criteria/index";
import type { Question } from "../../shared/laya-types";
import { REPO_ROOT, loadEnvFile, resolveFromRoot } from "./env";
import { gpuCandidates, isQuantized } from "./laya";

loadEnvFile();

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const SAMPLE = JSON.parse(readFileSync(path.join(REPO_ROOT, "shared", "sample-states.json"), "utf8")) as {
  states: { t: number; state: unknown }[];
};
const MAX_HZ = 4;

const pctl = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN;
};
const r0 = (v: number) => Math.round(v);

interface ChildResult {
  ep: string;
  model: string;
  quantized: boolean;
  threads: number;
  ok: boolean;
  error?: string;
  loadMs?: number;
  coldFirstCallMs?: number;
  warmFirstCallMs?: number;
  single?: { p50: number; p95: number };
  perCriterion?: Record<string, { p50: number; p95: number }>;
  serial10?: { p50: number; p95: number };
  batched10?: { p50: number; p95: number };
  rssMB?: number;
}

// ------------------------------------------------------------------ child
async function child(): Promise<void> {
  const ep = opt("ep")!;
  const modelDir = resolveFromRoot(opt("model-dir")!);
  const threads = Number(opt("threads", "8"));
  const n = Number(opt("n", "20"));
  const res: ChildResult = { ep, model: path.basename(modelDir), quantized: isQuantized(modelDir), threads, ok: false };
  try {
    const t0 = performance.now();
    const laya = await Laya.load({
      modelDir,
      executionProviders: [ep as never],
      sessionOptions: ep === "cpu" ? { intraOpNumThreads: threads } : {},
    });
    res.loadMs = r0(performance.now() - t0);
    const states = SAMPLE.states.filter((_, i) => i % Math.floor(SAMPLE.states.length / n) === 0).slice(0, n);
    const q = (c: (typeof CRITERIA)[number]) => ({ [c.name]: c.question as Question });

    let t = performance.now();
    await laya.systemOne(states[0].state, q(CRITERIA[0]));
    res.coldFirstCallMs = r0(performance.now() - t);
    for (let i = 0; i < 3; i++) await laya.systemOne(states[i % n].state, q(CRITERIA[i % CRITERIA.length]));
    t = performance.now();
    await laya.systemOne(states[1].state, q(CRITERIA[0]));
    res.warmFirstCallMs = r0(performance.now() - t);

    const single: number[] = [];
    const perC: Record<string, number[]> = {};
    const serial: number[] = [];
    for (const s of states) {
      let sum = 0;
      for (const c of CRITERIA) {
        const a = performance.now();
        await laya.systemOne(s.state, q(c));
        const ms = performance.now() - a;
        single.push(ms);
        (perC[c.name] ??= []).push(ms);
        sum += ms;
      }
      serial.push(sum);
    }
    const all = Object.fromEntries(CRITERIA.map((c) => [c.name, c.question as Question]));
    const batched: number[] = [];
    for (const s of states) {
      const a = performance.now();
      await laya.systemOne(s.state, all);
      batched.push(performance.now() - a);
    }
    const stat = (xs: number[]) => ({ p50: r0(pctl(xs, 50)), p95: r0(pctl(xs, 95)) });
    Object.assign(res, {
      ok: true,
      single: stat(single),
      perCriterion: Object.fromEntries(Object.entries(perC).map(([k, v]) => [k, stat(v)])),
      serial10: stat(serial),
      batched10: stat(batched),
      rssMB: r0(process.memoryUsage().rss / 1e6),
    });
    await laya.close();
  } catch (e) {
    res.error = String((e as Error).message ?? e).split("\n")[0].slice(0, 160);
  }
  process.stdout.write(`\n@@RESULT ${JSON.stringify(res)}\n`);
}

// ------------------------------------------------------------------ parent
function runChild(ep: string, modelDir: string, threads: number, n: number): ChildResult {
  const self = fileURLToPath(import.meta.url);
  const tsxCli = path.join(REPO_ROOT, "laya-service", "node_modules", "tsx", "dist", "cli.mjs");
  console.log(`-- ${ep} / ${path.basename(modelDir)} / ${threads} threads ...`);
  const childArgs = [tsxCli, self, "--child", "--ep", ep, "--model-dir", modelDir, "--threads", String(threads), "--n", String(n)];
  const p = spawnSync(process.execPath, childArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = (p.stdout ?? "").split("\n").find((l) => l.startsWith("@@RESULT "));
  if (!line) return { ep, model: path.basename(modelDir), quantized: false, threads, ok: false, error: (p.stderr || "no output").split("\n").filter(Boolean).pop()?.slice(0, 160) };
  const r = JSON.parse(line.slice(9)) as ChildResult;
  console.log(r.ok ? `   single p50 ${r.single!.p50} ms, serial10 p95 ${r.serial10!.p95} ms, rss ${r.rssMB} MB` : `   FAILED: ${r.error}`);
  return r;
}

export function recommendHz(serial10p95Ms: number): number {
  // largest rate whose period still fits 1.5 x the serial p95 of all 10 criteria, capped at MAX_HZ
  const hz = 1000 / (serial10p95Ms * 1.5);
  return Math.min(MAX_HZ, Math.floor(hz * 10) / 10);
}

function table(results: ChildResult[]): string {
  const head =
    "| EP | 모델 | 스레드 | 로드 ms | 콜드 첫 호출 ms | 워밍업 후 호출 ms | 기준 1개 p50 / p95 ms | 10개 개별 직렬 합 p50 / p95 ms | 10개 한 호출 p50 / p95 ms (비교용) | RSS MB | 권장 DECISION_HZ |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
  return (
    head +
    results
      .map((r) =>
        r.ok
          ? `| ${r.ep} | ${r.model}${r.quantized ? " (INT8)" : " (fp32)"} | ${r.ep === "cpu" ? r.threads : "-"} | ${r.loadMs} | ${r.coldFirstCallMs} | ${r.warmFirstCallMs} | ${r.single!.p50} / ${r.single!.p95} | ${r.serial10!.p50} / ${r.serial10!.p95} | ${r.batched10!.p50} / ${r.batched10!.p95} | ${r.rssMB} | ${recommendHz(r.serial10!.p95)} |`
          : `| ${r.ep} | ${r.model} | ${r.ep === "cpu" ? r.threads : "-"} | 실패: ${r.error?.replace(/\|/g, "/")} | | | | | | | |`,
      )
      .join("\n") +
    "\n"
  );
}

function perCriterionTable(r: ChildResult, scale = 1): string {
  return (
    "| 기준 | p50 ms | p95 ms |\n| --- | --- | --- |\n" +
    CRITERIA.map((c) => `| ${c.name} | ${r0(r.perCriterion![c.name].p50 * scale)} | ${r0(r.perCriterion![c.name].p95 * scale)} |`).join("\n") +
    "\n"
  );
}

/**
 * "calls of one cycle, p95 summed < period x 0.7". The scheduler defers low-priority criteria when a
 * cycle is over budget, so calls spread over cycles; in steady state the condition becomes
 *   sum_c p95_c x rate_c < 0.7   (busy fraction of the single serial queue)
 * All default rates are scaled by one common factor until it holds.
 */
function piRates(r: ChildResult, scale: number) {
  const load = (f: number) => CRITERIA.reduce((acc, c) => acc + (r.perCriterion![c.name].p95 * scale * c.rate.piHz * f) / 1000, 0);
  let factor = 1;
  while (factor > 0.001 && load(factor) >= 0.7) factor = factor > 0.1 ? Math.round((factor - 0.05) * 100) / 100 : Math.round(factor * 0.8 * 1000) / 1000;
  const rates = Object.fromEntries(CRITERIA.map((c) => [c.name, Math.round(c.rate.piHz * factor * 1000) / 1000]));
  const sumP95 = CRITERIA.reduce((s, c) => s + r.perCriterion![c.name].p95 * scale, 0);
  return { sumP95: r0(sumP95), maxHz: Math.max(...Object.values(rates)), rates, factor, load: load(factor) };
}

async function parent(): Promise<void> {
  const pi = flag("pi") || flag("pi-proxy");
  const proxy = flag("pi-proxy");
  const slowdown = Number(opt("pi-slowdown", "8"));
  const n = Number(opt("n", "20"));
  const threads = Number(opt("threads", pi ? "4" : process.env.LAYA_INTRA_THREADS || "8"));
  const eps = (opt("eps") ?? (pi ? "cpu" : [...gpuCandidates(), "cpu"].join(","))).split(",");
  const models = (opt("models") ?? "laya,laya-int8")
    .split(",")
    .map((m) => path.join(REPO_ROOT, "models", m))
    .filter((d) => existsSync(path.join(d, "laya.onnx")));
  let host = `${os.platform()}-${os.arch()}, ${os.cpus()[0]?.model.trim()} x${os.cpus().length}, ${r0(os.totalmem() / 2 ** 30)} GiB, node ${process.version}`;
  let date = new Date().toISOString().slice(0, 10);

  // raw results are saved next to the docs; --from-json re-renders the docs without re-measuring
  const rawPath = path.join(REPO_ROOT, "docs", pi ? "bench-pi.results.json" : "bench.results.json");
  let results: ChildResult[] = [];
  const from = opt("from-json");
  if (from) {
    const saved = JSON.parse(readFileSync(path.resolve(REPO_ROOT, from), "utf8")) as { host: string; date: string; results: ChildResult[] };
    ({ host, date, results } = saved);
  } else {
    for (const m of models) for (const ep of eps) results.push(runChild(ep, m, threads, n));
    writeFileSync(rawPath, JSON.stringify({ host, date, threads, n, results }, null, 1) + "\n");
  }
  const intro = `측정일: ${date}\n\n호스트: ${host}\n\n샘플: \`shared/sample-states.json\`의 state ${n}개 x 기준 10개 (클립 frodo_28126에서 생성).\n각 EP/모델 조합은 별도 프로세스에서 측정 (RSS·콜드 스타트 분리).\n`;

  if (!pi) {
    const auto = results.find((r) => r.ok && !r.quantized);
    const hz = auto ? recommendHz(auto.serial10!.p95) : 1;
    const md =
      `# Laya 벤치마크 (PC)\n\n${intro}\n${table(results)}\n` +
      `- **기준 1개**: 기준 하나 = \`systemOne\` 한 번 (본 설계).\n` +
      `- **10개 개별 직렬 합**: 한 state에 기준 10개를 각각 따로 직렬 호출한 총 지연 (본 설계의 1주기 최악 비용).\n` +
      `- **10개 한 호출**: 10개 질문을 한 \`systemOne\`에 배치 (비교용, 앱에서는 사용하지 않음).\n` +
      `- **권장 DECISION_HZ** = (10개 개별 직렬 합 p95 x 1.5)가 주기 안에 들어가는 최대값, 상한 ${MAX_HZ} Hz.\n` +
      `- 측정은 유휴 상태 기준이다. 시연 중에는 브라우저가 영상 3개를 그리며 GPU를 같이 쓰므로 WebGPU 호출이\n` +
      `  250–600 ms로 늘고 들쭉날쭉해진다 (같은 조건 CPU INT8 105–280 ms, docs/env-notes.md).\n` +
      `  게임 등 다른 GPU 작업이 돌면 수 배 더 느려지므로 벤치는 유휴 상태에서 다시 돌린다.\n\n` +
      `## 결론\n\n` +
      (auto
        ? `\`LAYA_EP=auto\`가 고르는 첫 EP는 **${auto.ep}**: 10개 직렬 p95 ${auto.serial10!.p95} ms → **DECISION_HZ=${hz}** (.env.local.example 기본값에 반영).\n` +
          `대시보드(PC 실측 모드)는 기준별 기본 rateHz에 이 값을 곱한다 (1 Hz 계열 = ${hz} Hz, 2 Hz 계열 = ${Math.round(hz * 20) / 10} Hz).\n`
        : "성공한 조합이 없음.\n");
    writeFileSync(path.join(REPO_ROOT, "docs", "bench.md"), md);
    const envEx = path.join(REPO_ROOT, ".env.local.example");
    writeFileSync(envEx, readFileSync(envEx, "utf8").replace(/^DECISION_HZ=.*$/m, `DECISION_HZ=${hz}`));
    console.log(`wrote docs/bench.md, DECISION_HZ=${hz}`);
    return;
  }

  const scale = proxy ? slowdown : 1;
  const ok = results.filter((r) => r.ok);
  // fp32 by default: dynamic INT8 failed the accuracy check (docs/quant-eval.md). --profile-model int8 overrides.
  const wantInt8 = opt("profile-model") === "int8";
  const pick = ok.find((r) => r.quantized === wantInt8) ?? ok[0];
  const fp32 = ok.find((r) => !r.quantized);
  if (!pick) throw new Error("no successful run");
  const pr = piRates(pick, scale);
  const profile = {
    source: proxy ? `estimated: ${host}, cpu ${threads} threads, latencies x${slowdown} (Pi 5 not measured yet)` : `measured: ${host}`,
    measured: !proxy,
    date,
    model: pick.quantized ? "laya-int8" : "laya",
    threads,
    p50Ms: Object.fromEntries(CRITERIA.map((c) => [c.name, r0(pick.perCriterion![c.name].p50 * scale)])),
    p95Ms: Object.fromEntries(CRITERIA.map((c) => [c.name, r0(pick.perCriterion![c.name].p95 * scale)])),
    cycleSumP95Ms: pr.sumP95,
    maxHz: pr.maxHz,
    rateFactor: pr.factor,
    rates: pr.rates,
    coldLoadMs: r0((pick.loadMs ?? 0) * scale),
    rssMB: pick.rssMB,
  };
  writeFileSync(path.join(REPO_ROOT, "shared", "pi-profile.json"), JSON.stringify(profile, null, 1) + "\n");

  const warn = ok.filter((r) => (r.rssMB ?? 0) > 3000).map((r) => `${r.model}: ${r.rssMB} MB`);
  const md =
    `# Laya 벤치마크 (Raspberry Pi 5 프로필)\n\n` +
    (proxy
      ? `> **주의: Pi 실측이 아니다.** 이 표는 PC CPU를 ${threads}스레드로 제한한 대리 측정값이고, Pi 예산 모드와\n` +
        `> \`shared/pi-profile.json\`은 이 값에 **x${slowdown} 감속 가정**을 곱한 추정치를 쓴다.\n` +
        `> Pi 5에서 \`pnpm bench:laya --pi\`를 실행하면 이 문서와 프로필이 실측값으로 교체된다.\n\n`
      : "") +
    `${intro}\n${table(results)}\n` +
    `## 기준별 지연 (${profile.model}${proxy ? `, x${slowdown} 추정` : ""})\n\n${perCriterionTable(pick, scale)}\n` +
    `## 스케줄러 rateHz (Pi 프로필)\n\n` +
    `조건: "한 주기 동안 실행되는 호출들의 p95 합 < 주기 x 0.7". 기준 10개가 한 주기에 모두 몰리는 최악의 경우\n` +
    `(p95 합 ${pr.sumP95} ms)는 스케줄러가 예산 초과분을 낮은 priority부터 다음 주기로 미루므로, 정상 상태 조건\n` +
    `Σ(p95 x rateHz) < 0.7 (단일 직렬 큐 점유율)을 쓴다. 기본 rateHz 전체에 같은 계수 **x${pr.factor}**를 곱해 점유율 ${(pr.load * 100).toFixed(0)}%.\n\n` +
    `| 기준 | 기본 rateHz | Pi rateHz |\n| --- | --- | --- |\n` +
    CRITERIA.map((c) => `| ${c.name} | ${c.rate.piHz} | ${pr.rates[c.name]} |`).join("\n") +
    `\n\n## 메모리\n\n` +
    `Laya 서비스 RSS: ${ok.map((r) => `${r.model} ${r.rssMB} MB`).join(", ")}. 예산 경고선 3 GB` +
    (warn.length ? ` — **초과: ${warn.join(", ")}**` : " — 초과 없음") +
    `. Pi 5 8 GB에서 OS + Hailo 파이프라인과 함께 운용 가능 여부 판단용.\n` +
    (fp32 && !pick.quantized
      ? `\n프로필 모델은 **fp32**. INT8(동적 양자화)은 속도는 2배(기준 1개 p50 ${ok.find((r) => r.quantized)?.single?.p50 ?? "-"} vs ${fp32.single!.p50} ms, 스케일 전)지만\n` +
        `정확도 회귀 검사에서 choice 일치율 48.5%로 실패해 쓰지 않는다 (docs/quant-eval.md). fp32는 RSS 경고선 3 GB를 약간 넘는다.\n`
      : "");
  writeFileSync(path.join(REPO_ROOT, "docs", "bench-pi.md"), md);
  console.log("wrote docs/bench-pi.md and shared/pi-profile.json");
}

if (flag("child")) await child();
else await parent();
