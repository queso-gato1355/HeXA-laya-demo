"use client";
import { useRouter } from "next/navigation";
import { CLIPS, getClip } from "@/data/routes";
import type { Profile } from "@/lib/useDecisions";
import type { DashboardStatus } from "@/lib/useLayaStatus";
import { type SystemMetrics, latest } from "@/lib/useSystemMetrics";
import { Badge } from "./ui";

const STATE_KO: Record<string, string> = { loading: "로딩 중", ready: "준비됨", missing: "모델 없음", error: "오류", unreachable: "연결 안 됨" };

export function StatusBar(props: {
  status: DashboardStatus;
  profile: Profile;
  setProfile: (p: Profile) => void;
  clipId: string;
  metrics: SystemMetrics;
}) {
  const { status, profile } = props;
  const router = useRouter();
  const clip = getClip(props.clipId);
  const sys = latest(props.metrics.dashboard)?.host;
  const ep = status.ep?.toUpperCase();
  const remote = status.endpointIsLocal === false;
  return (
    <header className="flex flex-wrap items-center gap-3 px-1">
      <h1 className="text-base font-bold tracking-tight">Laya 배달로봇 판단 시연</h1>
      <label className="flex items-center gap-1.5 text-[11px] text-slate-400" title={clip.description}>
        데모 영상
        <select
          value={props.clipId}
          onChange={(e) => router.push(`/?clip=${encodeURIComponent(e.target.value)}`)}
          className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-[12px] text-slate-100"
          aria-label="데모 영상 선택"
        >
          {CLIPS.map((c, i) => (
            <option key={c.clipId} value={c.clipId}>
              {i + 1}. {c.label} ({Math.round(c.durationS)}s)
            </option>
          ))}
        </select>
      </label>
      <span className="hidden text-[11px] text-slate-500 xl:inline">{clip.description} · 시연 전용, 실제 차량 제어용 아님</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {sys && (
          <span className="font-mono text-[10.5px] text-slate-400" title="대시보드 호스트 (사이드 탭 '리소스'에 그래프)">
            CPU {sys.cpuPct.toFixed(0)}% · RAM {(sys.memUsedMB / 1024).toFixed(1)}/{(sys.memTotalMB / 1024).toFixed(0)}GB
            {sys.gpu ? ` · GPU ${sys.gpu.utilPct.toFixed(0)}% ${(sys.gpu.memUsedMB / 1024).toFixed(1)}GB` : ""}
          </span>
        )}
        {status.state === "ready" ? (
          <Badge color={status.ep === "cpu" ? "#a16207" : "#047857"} title={status.epRequested ? `시도 순서: ${status.epRequested.join(" → ")}` : undefined}>
            Laya: {ep}
            {status.epFallback ? " (GPU 실패 → CPU 폴백)" : ""}
          </Badge>
        ) : (
          <Badge color={status.state === "loading" ? "#1d4ed8" : "#be123c"}>Laya: {STATE_KO[status.state] ?? status.state}</Badge>
        )}
        {status.quantized && <Badge color="#6d28d9">INT8</Badge>}
        {status.rssMB !== undefined && (
          <Badge color={status.rssWarn ? "#be123c" : "#334155"} title="laya-service 프로세스 RSS (Pi 예산 3GB)">
            RSS {status.rssMB}MB
          </Badge>
        )}
        <Badge color={remote ? "#7c3aed" : "#334155"} title="LAYA_ENDPOINT">
          {remote ? "Pi/원격 " : ""}
          {status.endpoint?.replace(/^https?:\/\//, "")}
        </Badge>
        <div className="flex overflow-hidden rounded border border-white/15 text-[11px]">
          {(
            [
              ["pc", "PC 실측"],
              ["pi", "Pi 예산"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              disabled={p === "pi" && remote}
              title={p === "pi" ? (remote ? "LAYA_ENDPOINT가 원격(Pi)이면 실측이 우선이라 비활성" : status.piProfile?.source) : "이 PC에서 실제 지연"}
              onClick={() => props.setProfile(p)}
              className={`px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${profile === p ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {profile === "pi" && status.piProfile && !status.piProfile.measured && (
          <span className="text-[10px] text-amber-300" title={status.piProfile.source}>
            Pi 지연은 추정치
          </span>
        )}
      </div>
    </header>
  );
}
