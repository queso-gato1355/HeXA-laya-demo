"use client";
// Sidebar tab "리소스": live CPU / RAM / GPU of the dashboard host and the Laya host (same machine on the
// PC, the rover's Pi when LAYA_ENDPOINT points there), plus the two server processes.
import type { MetricsSnapshot } from "@shared/metrics";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type SystemMetrics, latest } from "@/lib/useSystemMetrics";

const PI_RSS_BUDGET_GB = 3;

type Row = Record<string, number | null> & { s: number };

/** merge both hosts' samples on a "seconds ago" axis */
function rows(m: SystemMetrics): Row[] {
  const now = Math.max(latest(m.dashboard)?.t ?? 0, latest(m.laya)?.t ?? 0);
  const map = new Map<number, Row>();
  const put = (snaps: MetricsSnapshot[], f: (s: MetricsSnapshot) => Record<string, number | null>) => {
    for (const s of snaps) {
      const k = Math.round((s.t - now) / 1000);
      map.set(k, { ...(map.get(k) ?? { s: k }), ...f(s) });
    }
  };
  const gb = (mb: number) => Math.round((mb / 1024) * 100) / 100;
  put(m.dashboard, (s) => ({
    cpu: s.host.cpuPct,
    mem: gb(s.host.memUsedMB),
    nextCpu: s.proc.cpuPct,
    nextRss: gb(s.proc.rssMB),
    gpu: s.host.gpu?.utilPct ?? null,
    vram: s.host.gpu ? gb(s.host.gpu.memUsedMB) : null,
  }));
  put(m.laya, (s) => ({
    layaCpu: s.proc.cpuPct,
    layaRss: gb(s.proc.rssMB),
    ...(m.sameHost ? {} : { piCpu: s.host.cpuPct, piMem: gb(s.host.memUsedMB), piTemp: s.host.socTempC }),
  }));
  return [...map.values()].sort((a, b) => a.s - b.s);
}

function Chart(props: {
  title: string;
  value: string;
  data: Row[];
  lines: { key: string; name: string; color: string; dash?: string }[];
  domain: [number, number | "auto"];
  unit: string;
  refY?: { y: number; label: string };
}) {
  return (
    <div className="rounded bg-black/25 p-1.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="font-semibold text-slate-200">{props.title}</span>
        <span className="ml-auto font-mono text-slate-300">{props.value}</span>
      </div>
      <div className="h-[92px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="s" type="number" domain={["dataMin", 0]} tick={{ fill: "#64748b", fontSize: 9 }} tickFormatter={(v) => `${v}s`} />
            <YAxis domain={props.domain} tick={{ fill: "#64748b", fontSize: 9 }} />
            {props.refY && <ReferenceLine y={props.refY.y} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: props.refY.label, fill: "#f43f5e", fontSize: 9, position: "insideTopLeft" }} />}
            {props.lines.map((l) => (
              <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color} strokeDasharray={l.dash} dot={false} isAnimationActive={false} connectNulls strokeWidth={1.5} />
            ))}
            <Tooltip
              contentStyle={{ background: "#0e141c", border: "1px solid #334155", fontSize: 10 }}
              labelFormatter={(v) => `${v}s`}
              formatter={(v, n) => [`${Number(v).toFixed(1)} ${props.unit}`, n]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-2 text-[9.5px] text-slate-400">
        {props.lines.map((l) => (
          <span key={l.key}>
            <i className="mr-1 inline-block w-3 border-t-2 align-middle" style={{ borderColor: l.color, borderStyle: l.dash ? "dashed" : "solid" }} />
            {l.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResourcePanel({ metrics }: { metrics: SystemMetrics }) {
  const d = latest(metrics.dashboard);
  const l = latest(metrics.laya);
  const data = rows(metrics);
  if (!d) return <div className="p-2 text-xs text-slate-400">지표 수집 중…</div>;
  const gpu = d.host.gpu;
  const memTotalGB = d.host.memTotalMB / 1024;
  const remote = !metrics.sameHost;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      <div className="text-[10px] leading-snug text-slate-400">
        <div>
          대시보드 호스트 <b className="text-slate-200">{d.host.hostname}</b> · {d.host.cpuModel} ({d.host.cpuCores} 스레드) ·{" "}
          {memTotalGB.toFixed(0)} GB
        </div>
        <div>{gpu ? `GPU ${gpu.name}` : "GPU 지표 없음 (nvidia-smi 미검출)"}</div>
        {remote && l && (
          <div className="text-violet-300">
            Laya 호스트 (원격) <b>{l.host.hostname}</b> · {l.host.platform} · {l.host.cpuCores} 코어 · {(l.host.memTotalMB / 1024).toFixed(1)} GB
          </div>
        )}
        {metrics.layaError && <div className="text-amber-400">{metrics.layaError}</div>}
      </div>
      <Chart
        title="CPU"
        value={`${d.host.cpuPct.toFixed(0)}% · Laya ${l?.proc.cpuPct.toFixed(0) ?? "-"}%`}
        data={data}
        domain={[0, 100]}
        unit="%"
        lines={[
          { key: "cpu", name: remote ? "PC 전체" : "시스템 전체", color: "#38bdf8" },
          { key: "layaCpu", name: "laya-service", color: "#a78bfa" },
          { key: "nextCpu", name: "Next.js", color: "#94a3b8", dash: "3 3" },
          ...(remote ? [{ key: "piCpu", name: "Pi 전체", color: "#f472b6" }] : []),
        ]}
      />
      <Chart
        title="메모리"
        value={`${(d.host.memUsedMB / 1024).toFixed(1)} / ${memTotalGB.toFixed(0)} GB · Laya ${l ? (l.proc.rssMB / 1024).toFixed(2) : "-"} GB`}
        data={data}
        domain={[0, "auto"]}
        unit="GB"
        refY={{ y: PI_RSS_BUDGET_GB, label: "Pi Laya 예산 3GB" }}
        lines={[
          { key: "mem", name: remote ? "PC 사용" : "시스템 사용", color: "#38bdf8" },
          { key: "layaRss", name: "laya-service RSS", color: "#a78bfa" },
          { key: "nextRss", name: "Next.js RSS", color: "#94a3b8", dash: "3 3" },
          ...(remote ? [{ key: "piMem", name: "Pi 사용", color: "#f472b6" }] : []),
        ]}
      />
      {gpu ? (
        <Chart
          title="GPU"
          value={`${gpu.utilPct.toFixed(0)}% · ${(gpu.memUsedMB / 1024).toFixed(1)}/${(gpu.memTotalMB / 1024).toFixed(0)} GB${gpu.tempC !== null ? ` · ${gpu.tempC}°C` : ""}${gpu.powerW !== null ? ` · ${gpu.powerW.toFixed(0)}W` : ""}`}
          data={data}
          domain={[0, 100]}
          unit=""
          lines={[
            { key: "gpu", name: "사용률 %", color: "#34d399" },
            { key: "vram", name: "VRAM GB", color: "#facc15", dash: "3 3" },
          ]}
        />
      ) : (
        <div className="rounded bg-black/25 p-2 text-[11px] text-slate-500">GPU 지표 없음</div>
      )}
      {remote && l?.host.socTempC !== null && l?.host.socTempC !== undefined && (
        <Chart title="Pi SoC 온도" value={`${l.host.socTempC}°C`} data={data} domain={[30, 90]} unit="°C" lines={[{ key: "piTemp", name: "SoC", color: "#fb923c" }]} />
      )}
      <div className="text-[9.5px] leading-snug text-slate-500">
        1초 간격, 최근 5분. GPU는 장치 전체 사용률이라 게임·브라우저 영상 디코딩도 포함된다 (Windows WDDM에서는
        프로세스별 GPU 사용량을 얻을 수 없음). 프로세스 CPU %는 전체 코어 대비.
      </div>
    </div>
  );
}
