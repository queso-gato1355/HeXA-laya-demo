// Host / process resource sampling (Node only), shared by laya-service (GET /metrics) and the Next.js
// dashboard server (/api/system/metrics). Everything is local: os counters, process counters and an
// optional long-running `nvidia-smi -lms` stream (NVIDIA GPUs; absent on the Pi, where the SoC
// temperature is read from /sys instead).
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

export interface GpuMetrics {
  name: string;
  utilPct: number;
  memUsedMB: number;
  memTotalMB: number;
  tempC: number | null;
  powerW: number | null;
}

export interface HostMetrics {
  hostname: string;
  platform: string;
  cpuModel: string;
  cpuCores: number;
  /** whole-machine CPU busy %, since the previous sample */
  cpuPct: number;
  memUsedMB: number;
  memTotalMB: number;
  gpu: GpuMetrics | null;
  /** SoC temperature (Raspberry Pi / Linux thermal zone), null elsewhere */
  socTempC: number | null;
}

export interface ProcMetrics {
  name: string;
  pid: number;
  rssMB: number;
  /** share of the whole machine (100 % = every core busy) */
  cpuPct: number;
}

export interface MetricsSnapshot {
  /** epoch ms */
  t: number;
  host: HostMetrics;
  proc: ProcMetrics;
}

// ---------------------------------------------------------------- CPU (deltas between calls)
type CpuTimes = { idle: number; total: number };
function cpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

// ---------------------------------------------------------------- GPU (nvidia-smi stream)
const QUERY = "name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw";

class NvidiaSmiStream {
  latest: GpuMetrics | null = null;
  available = true;
  private child: ChildProcess | null = null;
  private buf = "";

  start() {
    if (this.child || !this.available) return;
    try {
      this.child = spawn("nvidia-smi", [`--query-gpu=${QUERY}`, "--format=csv,noheader,nounits", "-lms", "1000"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      this.available = false;
      return;
    }
    this.child.on("error", () => {
      this.available = false;
      this.child = null;
    });
    this.child.on("exit", () => {
      this.child = null;
    });
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (d: string) => {
      this.buf += d;
      const lines = this.buf.split(/\r?\n/);
      this.buf = lines.pop() ?? "";
      for (const line of lines) {
        const g = parseNvidiaSmiLine(line);
        if (g) this.latest = g;
      }
    });
    // never keep the process alive just for monitoring
    this.child.unref();
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }
}

/** one CSV line of `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw` */
export function parseNvidiaSmiLine(line: string): GpuMetrics | null {
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 6) return null;
  const num = (s: string) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };
  const util = num(parts[1]);
  const used = num(parts[2]);
  const total = num(parts[3]);
  if (util === null || used === null || total === null) return null;
  return { name: parts[0], utilPct: util, memUsedMB: used, memTotalMB: total, tempC: num(parts[4]), powerW: num(parts[5]) };
}

function socTemp(): number | null {
  if (process.platform !== "linux") return null;
  try {
    return Math.round(Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")) / 100) / 10;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- sampler
export const SAMPLE_MS = 1000;
export const HISTORY_LEN = 300; // 5 min at 1 Hz

/**
 * Samples once per SAMPLE_MS in the background and keeps a ring buffer, so any number of clients can
 * read without disturbing the CPU delta windows, and a dashboard opened later still gets history.
 */
export class MetricsSampler {
  readonly history: MetricsSnapshot[] = [];
  private prevCpu = cpuTimes();
  private prevProc = process.cpuUsage();
  private prevT = performance.now();
  private gpu = new NvidiaSmiStream();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private procName: string) {
    this.gpu.start();
    this.timer = setInterval(() => {
      this.history.push(this.sample());
      if (this.history.length > HISTORY_LEN) this.history.shift();
    }, SAMPLE_MS);
    this.timer.unref?.();
  }

  /** samples newer than `afterT` (epoch ms); all history when omitted */
  since(afterT?: number): MetricsSnapshot[] {
    return afterT ? this.history.filter((s) => s.t > afterT) : [...this.history];
  }

  private sample(): MetricsSnapshot {
    const now = performance.now();
    const cpu = cpuTimes();
    const dTotal = cpu.total - this.prevCpu.total;
    const dIdle = cpu.idle - this.prevCpu.idle;
    const proc = process.cpuUsage();
    const wallUs = Math.max(1, (now - this.prevT) * 1000);
    const cores = os.cpus().length;
    const procPct = ((proc.user - this.prevProc.user + proc.system - this.prevProc.system) / (wallUs * cores)) * 100;
    this.prevCpu = cpu;
    this.prevProc = proc;
    this.prevT = now;
    if (!this.gpu.latest) this.gpu.start();
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      t: Date.now(),
      host: {
        hostname: os.hostname(),
        platform: `${process.platform}-${process.arch}`,
        cpuModel: os.cpus()[0]?.model.trim() ?? "",
        cpuCores: cores,
        cpuPct: dTotal > 0 ? r1((1 - dIdle / dTotal) * 100) : 0,
        memUsedMB: Math.round((os.totalmem() - os.freemem()) / 2 ** 20),
        memTotalMB: Math.round(os.totalmem() / 2 ** 20),
        gpu: this.gpu.latest,
        socTempC: socTemp(),
      },
      proc: { name: this.procName, pid: process.pid, rssMB: Math.round(process.memoryUsage().rss / 2 ** 20), cpuPct: r1(Math.max(0, procPct)) },
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.gpu.stop();
  }
}
