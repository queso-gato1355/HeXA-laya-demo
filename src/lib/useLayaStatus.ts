"use client";
import type { LayaStatus } from "@shared/state";
import { useEffect, useRef, useState } from "react";

export type DashboardStatus = LayaStatus & {
  decisionHz?: number;
  piProfile?: { source: string; measured: boolean; model: string };
};

/** Polls /api/laya/status (fast while loading, slow once ready) and warms the model up once. */
export function useLayaStatus(): DashboardStatus {
  const [status, setStatus] = useState<DashboardStatus>({ state: "loading", message: "상태 확인 중" });
  const warmed = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next: DashboardStatus;
      try {
        next = await fetch("/api/laya/status", { cache: "no-store" }).then((r) => r.json());
      } catch (e) {
        next = { state: "unreachable", message: `대시보드 서버 응답 없음: ${(e as Error).message}` };
      }
      if (stop) return;
      setStatus(next);
      if (next.state === "ready" && !warmed.current) {
        warmed.current = true;
        void fetch("/api/laya/warmup", { method: "POST" }).catch(() => undefined);
      }
      timer = setTimeout(poll, next.state === "ready" ? 10000 : 2000);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  return status;
}
