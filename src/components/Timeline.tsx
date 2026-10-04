"use client";
// Bottom: playback controls + seek slider with collision_risk / emergency_stop series and markers for
// final-command changes, hard-safety interventions and Laya catching up late.
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/lib/useDecisions";

export interface TimelineEvent {
  t: number;
  kind: "command" | "safety" | "laya-late";
  label: string;
}

const EVENT_COLOR = { command: "#94a3b8", safety: "#f43f5e", "laya-late": "#f59e0b" };

export function Timeline(props: {
  t: number;
  duration: number;
  playing: boolean;
  rate: number;
  history: HistoryPoint[];
  events: TimelineEvent[];
  crossings: { tStart: number; tEnd: number }[];
  onSeek: (t: number) => void;
  onToggle: () => void;
  onRate: (r: number) => void;
}) {
  const { t, duration, history, events } = props;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return (
    <section className="panel">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => props.onSeek(Math.max(0, t - 5))} className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
          −5s
        </button>
        <button type="button" onClick={props.onToggle} className="w-20 rounded bg-sky-600 px-3 py-1 text-sm font-semibold hover:bg-sky-500">
          {props.playing ? "일시정지" : "재생"}
        </button>
        <button type="button" onClick={() => props.onSeek(Math.min(duration, t + 5))} className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
          +5s
        </button>
        <select value={props.rate} onChange={(e) => props.onRate(Number(e.target.value))} className="rounded bg-slate-800 px-1 py-1 text-xs">
          {[0.25, 0.5, 1, 1.5, 2].map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
        <span className="font-mono text-sm tabular-nums">
          {fmt(t)} / {fmt(duration)}
        </span>
        <div className="ml-auto flex gap-3 text-[10px] text-slate-400">
          <span><i className="mr-1 inline-block h-0.5 w-3 bg-rose-500 align-middle" />collision_risk (0–4)</span>
          <span><i className="mr-1 inline-block h-0.5 w-3 bg-violet-400 align-middle" />emergency_stop (0–1)</span>
          <span><i className="mr-1 inline-block h-2 w-0.5 bg-slate-400 align-middle" />최종 명령 변경</span>
          <span><i className="mr-1 inline-block h-2 w-0.5 bg-rose-500 align-middle" />하드 안전 개입</span>
          <span><i className="mr-1 inline-block h-2 w-0.5 bg-amber-500 align-middle" />Laya 뒤늦은 위험 판단</span>
          <span><i className="mr-1 inline-block h-2 w-3 bg-orange-400/30 align-middle" />횡단 구간</span>
        </div>
      </div>
      <div className="mt-1 h-[92px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} onClick={(e) => e?.activeLabel !== undefined && props.onSeek(Number(e.activeLabel))}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, duration]} tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `${v}s`} />
            <YAxis yAxisId="c" domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tick={{ fill: "#64748b", fontSize: 10 }} />
            <YAxis yAxisId="e" orientation="right" domain={[0, 1]} hide />
            {props.crossings.map((c) => (
              <ReferenceArea key={c.tStart} yAxisId="c" x1={c.tStart} x2={c.tEnd} fill="#fb923c" fillOpacity={0.12} />
            ))}
            <ReferenceLine yAxisId="c" y={3} stroke="#f43f5e" strokeDasharray="3 3" strokeOpacity={0.5} />
            {events.map((ev) => (
              <ReferenceLine key={`${ev.kind}-${ev.t}`} yAxisId="c" x={ev.t} stroke={EVENT_COLOR[ev.kind]} strokeWidth={ev.kind === "command" ? 1 : 2} strokeOpacity={0.8} />
            ))}
            <ReferenceLine yAxisId="c" x={t} stroke="#38bdf8" strokeWidth={2} />
            <Line yAxisId="c" dataKey="collision" stroke="#f43f5e" dot={false} isAnimationActive={false} connectNulls strokeWidth={1.5} />
            <Line yAxisId="e" dataKey="emergency" stroke="#a78bfa" dot={false} isAnimationActive={false} connectNulls strokeWidth={1.5} />
            <Tooltip
              contentStyle={{ background: "#0e141c", border: "1px solid #334155", fontSize: 11 }}
              labelFormatter={(v) => `t=${Number(v).toFixed(1)}s`}
              formatter={(v, n) => [Number(v).toFixed(2), n === "collision" ? "collision_risk" : "emergency_stop"]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={t}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        className="w-full accent-sky-500"
        aria-label="탐색"
      />
    </section>
  );
}
