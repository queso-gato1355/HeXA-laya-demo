"use client";
// Overlay on the original video, drawn on canvas/HTML (never burned into the video), every element
// toggleable:
//  - GPS 경로: the recorded GPS route projected with the fused heading (white dashed line)
//  - Laya 주행도: "Tesla-style" translucent blue ribbon of the path the final command implies
//  - navigation arrow, speed, final command badge
import { ACTION_KO, type FinalCommand } from "@/lib/arbiter";
import type { PlannedPath } from "@/lib/plannedPath";
import { MANEUVER_KO, type NavInstruction } from "@/lib/route/maneuver";
import { useEffect, useRef } from "react";
import { Badge } from "./ui";

export interface OverlayToggles {
  gps: boolean;
  laya: boolean;
  nav: boolean;
  speed: boolean;
  command: boolean;
}

export type Px = { u: number; v: number };

export interface RibbonPx {
  kind: PlannedPath["kind"];
  left: Px[];
  right: Px[];
}

const SPEED_KO = { stop: "정지", crawl: "최저속", slow: "서행", normal: "보통" } as const;
const ARROW_DEG: Record<string, number> = {
  straight: 0,
  slight_left: -45,
  turn_left: -90,
  slight_right: 45,
  turn_right: 90,
  u_turn: 180,
};
const RIBBON_RGB = { drive: "59,130,246", yield: "245,158,11", stop: "244,63,94" };

function drawRibbon(g: CanvasRenderingContext2D, rb: RibbonPx) {
  const n = Math.min(rb.left.length, rb.right.length);
  if (n < 2) return;
  const rgb = RIBBON_RGB[rb.kind];
  const vNear = Math.max(rb.left[0].v, rb.right[0].v);
  const vFar = Math.min(rb.left[n - 1].v, rb.right[n - 1].v);
  const grad = g.createLinearGradient(0, vNear, 0, Math.min(vFar, vNear - 1));
  grad.addColorStop(0, `rgba(${rgb},0.55)`);
  grad.addColorStop(1, `rgba(${rgb},0.12)`);
  g.save();
  g.beginPath();
  rb.left.slice(0, n).forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
  for (let i = n - 1; i >= 0; i--) g.lineTo(rb.right[i].u, rb.right[i].v);
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  // soft edges
  g.strokeStyle = `rgba(${rgb},0.6)`;
  g.lineWidth = 2;
  for (const edge of [rb.left, rb.right]) {
    g.beginPath();
    edge.slice(0, n).forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
    g.stroke();
  }
  // stop / yield: a bar across the end of the path
  if (rb.kind !== "drive") {
    g.strokeStyle = `rgba(${rgb},0.95)`;
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(rb.left[n - 1].u, rb.left[n - 1].v);
    g.lineTo(rb.right[n - 1].u, rb.right[n - 1].v);
    g.stroke();
  }
  g.restore();
}

export function OverlayCanvas(props: {
  width: number;
  height: number;
  toggles: OverlayToggles;
  future: Px[][];
  past: Px[][];
  ribbon: RibbonPx | null;
  nav: NavInstruction;
  speedMps: number;
  command: FinalCommand;
}) {
  const { width, height, toggles, future, past, ribbon, nav, speedMps, command } = props;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, width, height);
    if (toggles.laya && ribbon) drawRibbon(g, ribbon);
    if (toggles.gps) {
      const line = (runs: Px[][], color: string, alpha: number, w: number, dash: number[]) => {
        g.save();
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = w;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.setLineDash(dash);
        for (const run of runs) {
          g.beginPath();
          run.forEach((p, i) => (i ? g.lineTo(p.u, p.v) : g.moveTo(p.u, p.v)));
          g.stroke();
        }
        g.restore();
      };
      line(past, "#cbd5e1", 0.3, 3, [6, 8]);
      line(future, "#0f172a", 0.5, 7, []);
      line(future, "#f8fafc", 0.95, 3, [14, 10]);
    }
  }, [width, height, toggles.gps, toggles.laya, future, past, ribbon]);

  const kmh = speedMps * 3.6;
  const danger = command.action === "STOP";
  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={ref} width={width} height={height} className="absolute inset-0 h-full w-full" />
      {toggles.speed && (
        <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-[13px] text-white">
          {speedMps.toFixed(1)} m/s <span className="text-slate-300">({kmh.toFixed(1)} km/h)</span>
        </div>
      )}
      {toggles.nav && (
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-white">
          {nav.maneuver === "arrived" ? (
            <span className="text-2xl">🏁</span>
          ) : (
            <svg width="30" height="30" viewBox="-15 -15 30 30" style={{ transform: `rotate(${ARROW_DEG[nav.maneuver] ?? 0}deg)` }}>
              <path d="M0,-13 L10,0 L4,0 L4,13 L-4,13 L-4,0 L-10,0 Z" fill="#f8fafc" />
            </svg>
          )}
          <span className="text-lg font-semibold">
            {MANEUVER_KO[nav.maneuver]} · {nav.distM.toFixed(0)}m
          </span>
          <span className="text-[10px] text-slate-400">내비</span>
        </div>
      )}
      {toggles.command && (
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          <div
            className="rounded-lg px-3 py-1.5 text-right text-white shadow"
            style={{ background: danger ? "#be123c" : command.action === "yield_wait" ? "#b45309" : "#1d4ed8" }}
          >
            <div className="text-[10px] leading-none opacity-80">최종 명령</div>
            <div className="text-lg font-bold leading-tight">
              {ACTION_KO[command.action]} · {SPEED_KO[command.speed]}
            </div>
          </div>
          {command.safetyOverride && <Badge color="#e11d48">SAFETY OVERRIDE</Badge>}
          {command.degraded && <Badge color="#a16207">판단 지연</Badge>}
        </div>
      )}
      {(toggles.gps || toggles.laya) && (
        <div className="absolute bottom-2 left-2 flex gap-3 rounded bg-black/55 px-2 py-1 text-[11px] text-slate-200">
          {toggles.laya && (
            <span className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-4 rounded-sm bg-blue-500/60" /> Laya 주행도
            </span>
          )}
          {toggles.gps && (
            <span className="flex items-center gap-1">
              <i className="inline-block w-4 border-t-2 border-dashed border-white" /> GPS 경로
            </span>
          )}
        </div>
      )}
    </div>
  );
}
