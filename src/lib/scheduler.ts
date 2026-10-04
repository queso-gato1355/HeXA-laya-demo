// Per-criterion rate scheduler. Requests of one cycle are sent as independent fetches (one per
// criterion) but laya-service runs them one at a time, so the cycle's cost is the *sum* of latencies.
// If the estimated sum exceeds BUDGET_FRACTION of the cycle, low-priority criteria are skipped.

export const BUDGET_FRACTION = 0.7;
/** a criterion is due slightly before its nominal period so 2 Hz really fires every 0.5 s cycle */
const DUE_TOLERANCE_S = 0.05;

export interface SchedEntry {
  name: string;
  rateHz: number;
  priority: number;
  applies: boolean;
}

export interface CyclePlan {
  run: string[];
  /** due but dropped for budget */
  skipped: string[];
  /** not applicable in this state (e.g. crossing_safe outside a crossing) */
  notApplicable: string[];
  estMs: number;
  budgetMs: number;
}

export function cyclePeriodS(entries: SchedEntry[], maxHz = Infinity): number {
  const hz = Math.min(maxHz, Math.max(...entries.map((e) => e.rateHz)));
  return 1 / hz;
}

export function isDue(now: number, last: number | undefined, rateHz: number): boolean {
  if (last === undefined) return true;
  if (last > now + 1e-6) return true; // seeked backwards
  return now - last >= 1 / rateHz - DUE_TOLERANCE_S;
}

export function planCycle(opts: {
  now: number;
  entries: SchedEntry[];
  lastRun: Record<string, number | undefined>;
  periodS: number;
  estimateMs: (name: string) => number;
  /** ignore rates (pause / seek re-evaluation) */
  force?: boolean;
}): CyclePlan {
  const { now, entries, lastRun, periodS, estimateMs, force } = opts;
  const budgetMs = periodS * 1000 * BUDGET_FRACTION;
  const notApplicable = entries.filter((e) => !e.applies).map((e) => e.name);
  const due = entries
    .filter((e) => e.applies && (force || isDue(now, lastRun[e.name], e.rateHz)))
    .sort((a, b) => a.priority - b.priority || b.rateHz - a.rateHz);
  const run: string[] = [];
  const skipped: string[] = [];
  let est = 0;
  for (const e of due) {
    const c = estimateMs(e.name);
    // the highest-priority due criterion always runs, even if it alone exceeds the budget
    if (run.length === 0 || force || est + c <= budgetMs) {
      run.push(e.name);
      est += c;
    } else {
      skipped.push(e.name);
    }
  }
  return { run, skipped, notApplicable, estMs: Math.round(est), budgetMs: Math.round(budgetMs) };
}

/**
 * Rolling latency estimate per criterion: ~p80 of the last N samples, `fallbackMs` until data exists.
 * The first sample of each criterion is dropped: it is a cold start (GPU shader compilation can take
 * seconds) and would otherwise make the scheduler skip criteria for many cycles.
 */
export class LatencyTracker {
  private hist = new Map<string, number[]>();
  private seen = new Set<string>();
  constructor(
    private fallbackMs: number,
    private n = 8,
  ) {}
  add(name: string, ms: number) {
    if (!this.seen.has(name)) {
      this.seen.add(name);
      return;
    }
    const h = this.hist.get(name) ?? [];
    h.push(ms);
    if (h.length > this.n) h.shift();
    this.hist.set(name, h);
  }
  has(name: string): boolean {
    return (this.hist.get(name)?.length ?? 0) > 0;
  }
  estimate(name: string): number {
    const h = this.hist.get(name);
    if (!h?.length) return this.fallbackMs;
    const s = [...h].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.8))];
  }
  setFallback(ms: number) {
    this.fallbackMs = ms;
  }
}
