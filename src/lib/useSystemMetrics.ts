"use client";
// Polls /api/system/metrics once a second and keeps up to 5 min of samples for the dashboard host and
// the laya-service host. Only samples newer than what we already have are transferred.
import type { MetricsSnapshot } from "@shared/metrics";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 1000;
const KEEP = 300;

export interface SystemMetrics {
  dashboard: MetricsSnapshot[];
  laya: MetricsSnapshot[];
  /** laya-service runs on this same machine (local endpoint) */
  sameHost: boolean;
  layaError?: string;
}

const append = (prev: MetricsSnapshot[], add: MetricsSnapshot[]) => (add.length ? [...prev, ...add].slice(-KEEP) : prev);

export function useSystemMetrics(): SystemMetrics {
  const [m, setM] = useState<SystemMetrics>({ dashboard: [], laya: [], sameHost: true });
  const last = useRef({ dash: 0, laya: 0 });

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/system/metrics?afterDash=${last.current.dash}&afterLaya=${last.current.laya}`, { cache: "no-store" });
        const d = (await r.json()) as { dashboard: MetricsSnapshot[]; laya: MetricsSnapshot[] | null; sameHost: boolean; layaError?: string };
        if (stop) return;
        if (d.dashboard.length) last.current.dash = d.dashboard[d.dashboard.length - 1].t;
        if (d.laya?.length) last.current.laya = d.laya[d.laya.length - 1].t;
        setM((prev) => ({
          dashboard: append(prev.dashboard, d.dashboard),
          laya: append(prev.laya, d.laya ?? []),
          sameHost: d.sameHost,
          layaError: d.layaError,
        }));
      } catch {
        // dashboard server restarting: keep the history and retry
      }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  return m;
}

export const latest = (s: MetricsSnapshot[]) => (s.length ? s[s.length - 1] : null);
