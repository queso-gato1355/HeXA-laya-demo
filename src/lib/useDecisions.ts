"use client";
// Decision loop: every cycle the scheduler picks the due criteria; each one is its own fetch
// (/api/laya/<criterion>), all settled independently so one failure never hides the others.
import { CRITERIA } from "@shared/criteria/index";
import type { CriterionResponse, LayaState } from "@shared/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type StateContext, buildState } from "./state/buildState";
import { type CyclePlan, LatencyTracker, type SchedEntry, cyclePeriodS, planCycle } from "./scheduler";

export type Profile = "pc" | "pi";

export interface CriterionResult {
  name: string;
  /** playback time of the state that was judged */
  t: number;
  /** playback time when the answer arrived */
  receivedAt: number;
  state: LayaState;
  response: CriterionResponse;
}

export interface HistoryPoint {
  t: number;
  collision?: number;
  emergency?: number;
}

export interface DecisionEngine {
  results: Record<string, CriterionResult>;
  errors: Record<string, string>;
  plan: CyclePlan | null;
  history: HistoryPoint[];
  inflight: boolean;
  rates: Record<string, number>;
  periodS: number;
  evaluateNow: () => void;
  reset: () => void;
}

const TICK_MS = 50;

export function useDecisions(opts: {
  clipId: string;
  ctx: StateContext | null;
  getT: () => number;
  playing: boolean;
  ready: boolean;
  profile: Profile;
  decisionHz: number;
  piRates: Record<string, number>;
  piP95: Record<string, number>;
}): DecisionEngine {
  const { clipId, ctx, getT, playing, ready, profile, decisionHz, piRates, piP95 } = opts;
  const [results, setResults] = useState<Record<string, CriterionResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<CyclePlan | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [inflight, setInflight] = useState(false);

  const inflightRef = useRef(false);
  const forceRef = useRef(false);
  const lastRun = useRef<Record<string, number | undefined>>({});
  const tracker = useRef(new LatencyTracker(100));

  const rates = useMemo(
    () =>
      Object.fromEntries(
        // PC: DECISION_HZ scales the per-criterion base rates (1 Hz tier = DECISION_HZ, 2 Hz tier = 2x);
        // Pi: rates from shared/pi-profile.json (docs/bench-pi.md)
        CRITERIA.map((c) => [
          c.name,
          profile === "pi" ? (piRates[c.name] ?? c.rate.piHz) : Math.round(c.rate.pcHz * decisionHz * 100) / 100,
        ]),
      ),
    [profile, decisionHz, piRates],
  );

  const entriesFor = useCallback(
    (state: LayaState): SchedEntry[] =>
      CRITERIA.map((c) => ({ name: c.name, rateHz: rates[c.name], priority: c.priority, applies: c.appliesTo?.(state) ?? true })),
    [rates],
  );
  const periodS = useMemo(() => cyclePeriodS(CRITERIA.map((c) => ({ name: c.name, rateHz: rates[c.name], priority: 0, applies: true }))), [rates]);

  // a profile switch invalidates latency estimates and schedule
  useEffect(() => {
    tracker.current = new LatencyTracker(profile === "pi" ? 1000 : 100);
    lastRun.current = {};
    forceRef.current = true;
  }, [profile]);

  const runCycle = useCallback(
    async (force: boolean) => {
      if (!ctx) return;
      const now = getT();
      const state = buildState(now, ctx);
      const p = planCycle({
        now,
        entries: entriesFor(state),
        lastRun: lastRun.current,
        periodS,
        estimateMs: (n) => (tracker.current.has(n) || profile === "pc" ? tracker.current.estimate(n) : (piP95[n] ?? 1000)),
        force,
      });
      setPlan(p);
      if (!p.run.length) return;
      inflightRef.current = true;
      setInflight(true);
      for (const n of p.run) lastRun.current[n] = now;
      const settled = await Promise.allSettled(
        p.run.map(async (name) => {
          const r = await fetch(`/api/laya/${name}?profile=${profile}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clipId, t: Math.round(now * 100) / 100, state }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
          const res = data as CriterionResponse;
          tracker.current.add(name, res.latencyMs);
          // publish as soon as this criterion answers (independent of the others)
          const result: CriterionResult = { name, t: now, receivedAt: getT(), state, response: res };
          setResults((prev) => ({ ...prev, [name]: result }));
          setErrors((prev) => {
            if (!(name in prev)) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
          });
          return result;
        }),
      );
      const fresh: HistoryPoint = { t: Math.round(now * 10) / 10 };
      settled.forEach((s, i) => {
        const name = p.run[i];
        if (s.status === "rejected") {
          setErrors((prev) => ({ ...prev, [name]: String((s.reason as Error)?.message ?? s.reason) }));
          return;
        }
        const a = s.value.response.answer;
        if (name === "collision_risk" && a.type === "score") fresh.collision = a.score;
        if (name === "emergency_stop" && a.type === "noul") fresh.emergency = a.noul;
      });
      if (fresh.collision !== undefined || fresh.emergency !== undefined) {
        setHistory((prev) => {
          const others = prev.filter((h) => h.t !== fresh.t);
          const old = prev.find((h) => h.t === fresh.t);
          return [...others, { ...old, ...fresh }].sort((a, b) => a.t - b.t);
        });
      }
      inflightRef.current = false;
      setInflight(false);
    },
    [ctx, getT, entriesFor, periodS, profile, clipId, piP95],
  );

  useEffect(() => {
    if (!ready || !ctx) return;
    const id = setInterval(() => {
      // skip the tick while the previous cycle's requests are still running
      if (inflightRef.current) return;
      const force = forceRef.current;
      if (!playing && !force) return;
      forceRef.current = false;
      void runCycle(force);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready, ctx, playing, runCycle]);

  const evaluateNow = useCallback(() => {
    forceRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setResults({});
    setHistory([]);
    lastRun.current = {};
  }, []);

  return { results, errors, plan, history, inflight, rates, periodS, evaluateNow, reset };
}
