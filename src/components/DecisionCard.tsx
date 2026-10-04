"use client";
import type { CriterionDef } from "@shared/criteria/index";
import type { CriterionResult } from "@/lib/useDecisions";
import { riskColor } from "./ui";

const TYPE_KO = { choice: "선택", score: "점수", noul: "예/아니오" };

export function DecisionCard(props: {
  def: CriterionDef;
  result?: CriterionResult;
  error?: string;
  applies: boolean;
  rateHz: number;
  now: number;
  onOpen: () => void;
}) {
  const { def, result, error, applies, rateHz, now } = props;
  const d = result?.response.display;
  const age = result ? now - result.t : null;
  // grey out when no update for 2 periods (or the answer belongs to a later time after seeking back)
  const old = age !== null && (age > 2 / rateHz || age < -0.25);
  const level = d?.level ?? null;
  const border = def.emphasize && d && !old ? riskColor(level) : "rgba(255,255,255,0.08)";
  const emphasizeBg = def.emphasize && d && !old && level !== null && level >= 2 ? `${riskColor(level)}22` : undefined;

  return (
    <button
      type="button"
      onClick={props.onOpen}
      disabled={!result}
      className={`flex min-h-[92px] flex-col rounded-md border-2 bg-[#0e141c] p-1.5 text-left transition hover:bg-[#162030] disabled:cursor-default ${old || !applies ? "opacity-45 grayscale" : ""}`}
      style={{ borderColor: border, background: emphasizeBg }}
      title={result ? "클릭: 입력 state / 원본 응답 JSON" : undefined}
    >
      <div className="flex items-baseline gap-1">
        <span className="text-[12px] font-semibold text-slate-100">{def.labelKo}</span>
        <span className="truncate font-mono text-[9px] text-slate-500">{def.name}</span>
        <span className="ml-auto shrink-0 text-[9px] text-slate-500">
          {TYPE_KO[def.question.type]} · {rateHz}Hz
        </span>
      </div>
      {!applies ? (
        <div className="mt-2 text-[13px] text-slate-400">해당 없음 <span className="text-[10px]">(횡단 구간 아님)</span></div>
      ) : d ? (
        <>
          <div className="mt-0.5 text-[15px] font-bold leading-tight" style={{ color: level !== null ? riskColor(level) : "#e2e8f0" }}>
            {d.text}
          </div>
          <div className="mt-1 flex h-4 items-end gap-[2px]" aria-label="확률 분포">
            {d.dist.map((x) => (
              <div key={x.key} className="flex-1" title={`${x.label}: ${(x.p * 100).toFixed(1)}%`}>
                <div className="w-full rounded-sm bg-sky-400/80" style={{ height: `${Math.max(2, x.p * 16)}px` }} />
              </div>
            ))}
          </div>
          <div className="mt-0.5 flex gap-[2px] text-[8px] leading-none text-slate-500">
            {d.dist.map((x) => (
              <span key={x.key} className="flex-1 truncate text-center">
                {x.label}
              </span>
            ))}
          </div>
          <div className="mt-auto flex gap-2 pt-1 font-mono text-[9.5px] text-slate-400">
            <span>{result!.response.latencyMs}ms{result!.response.simulatedDelayMs ? ` (Pi+${result!.response.simulatedDelayMs})` : ""}{result!.response.cached ? " 캐시" : ""}</span>
            <span>t={result!.t.toFixed(1)}s</span>
            <span className={old ? "text-amber-400" : ""}>나이 {age!.toFixed(1)}s</span>
          </div>
        </>
      ) : error ? (
        <div className="mt-2 text-[11px] text-rose-400">오류: {error}</div>
      ) : (
        <div className="mt-2 text-[12px] text-slate-500">대기 중…</div>
      )}
    </button>
  );
}
