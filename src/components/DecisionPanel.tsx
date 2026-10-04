"use client";
// Bottom-right: final command + arbiter rules + one card per criterion (each its own API call).
import { CRITERIA } from "@shared/criteria/index";
import type { LayaState } from "@shared/state";
import { useState } from "react";
import { ACTION_KO, type FinalCommand, RULES, STALE_RULE_KO } from "@/lib/arbiter";
import type { DecisionEngine, Profile } from "@/lib/useDecisions";
import type { DashboardStatus } from "@/lib/useLayaStatus";
import { DecisionCard } from "./DecisionCard";
import { Badge } from "./ui";

const SPEED_KO = { stop: "정지", crawl: "최저속", slow: "서행", normal: "보통" } as const;

function JsonModal({ title, state, response, onClose }: { title: string; state: unknown; response: unknown; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="flex max-h-[85vh] w-[min(1100px,95vw)] flex-col rounded-lg border border-white/15 bg-[#0e141c] p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" className="ml-auto rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {(
            [
              ["입력 state (Laya에 전달)", state],
              ["원본 응답", response],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="flex min-h-0 flex-col">
              <div className="mb-1 text-[11px] text-slate-400">{label}</div>
              <pre className="min-h-0 flex-1 overflow-auto rounded bg-black/50 p-2 font-mono text-[11px] leading-snug text-emerald-200">
                {JSON.stringify(v, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DecisionPanel(props: {
  engine: DecisionEngine;
  command: FinalCommand;
  state: LayaState | null;
  now: number;
  status: DashboardStatus;
  profile: Profile;
}) {
  const { engine, command, state, now, status, profile } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const openRes = open ? engine.results[open] : undefined;
  const plan = engine.plan;

  return (
    <section className="panel flex min-h-[360px] flex-col [contain:size]">
      <div className="panel-title">
        Laya 판단
        <span className="text-[11px] font-normal text-slate-400">기준별 개별 API · systemOne 1회 · 질문 1개</span>
        <Badge color={profile === "pi" ? "#7c3aed" : "#334155"}>{profile === "pi" ? "Pi 예산" : "PC 실측"}</Badge>
      </div>

      {status.state !== "ready" ? (
        <ModelState status={status} />
      ) : (
        <>
          <div
            className="mb-1.5 flex items-center gap-3 rounded-md px-3 py-1.5"
            style={{ background: command.action === "STOP" ? "#4c0519" : command.action === "yield_wait" ? "#451a03" : "#042f2e" }}
          >
            <div>
              <div className="text-[10px] text-slate-300">최종 명령 (아비터)</div>
              <div className="text-xl font-bold">
                {ACTION_KO[command.action]} <span className="text-base font-semibold text-slate-200">· {SPEED_KO[command.speed]}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-slate-300">
              <span>
                규칙: <b>{RULES.find((r) => r.id === command.rule)?.textKo}</b>
              </span>
              <span>근거: {command.reasonKo}</span>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1">
              {command.safetyOverride && <Badge color="#e11d48">SAFETY OVERRIDE</Badge>}
              {command.degraded && (
                <Badge color="#a16207" title={`제외: ${command.stale.join(", ")}`}>
                  판단 지연 ({command.stale.length})
                </Badge>
              )}
              <button type="button" className="text-[10px] text-sky-400 underline" onClick={() => setShowRules((v) => !v)}>
                규칙 {showRules ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
          {showRules && (
            <ol className="mb-1.5 list-decimal rounded bg-black/30 py-1 pl-6 pr-2 text-[11px] text-slate-300">
              {RULES.map((r) => (
                <li key={r.id} className={r.id === command.rule ? "font-semibold text-white" : ""}>
                  {r.textKo}
                </li>
              ))}
              <li className="list-none text-amber-300/90">※ {STALE_RULE_KO}</li>
            </ol>
          )}
          <div className="mb-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-slate-400">
            <span>주기 {engine.periodS.toFixed(2)}s</span>
            {plan && (
              <>
                <span>이번 주기 실행 {plan.run.length}</span>
                <span>
                  예상 {plan.estMs}ms / 예산 {plan.budgetMs}ms
                </span>
                {plan.skipped.length > 0 && <span className="text-amber-400">예산 초과 건너뜀: {plan.skipped.join(", ")}</span>}
              </>
            )}
            {engine.inflight && <span className="text-sky-400">요청 중…</span>}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
            {CRITERIA.map((def) => (
              <DecisionCard
                key={def.name}
                def={def}
                result={engine.results[def.name]}
                error={engine.errors[def.name]}
                applies={state ? (def.appliesTo?.(state) ?? true) : true}
                rateHz={engine.rates[def.name]}
                now={now}
                onOpen={() => setOpen(def.name)}
              />
            ))}
          </div>
        </>
      )}
      {openRes && (
        <JsonModal
          title={`${CRITERIA.find((c) => c.name === open)?.labelKo} (${open}) · t=${openRes.t.toFixed(2)}s`}
          state={openRes.state}
          response={openRes.response}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function ModelState({ status }: { status: DashboardStatus }) {
  const text: Record<string, string> = {
    loading: "Laya 모델을 로컬 번들에서 불러오는 중입니다…",
    missing: "Laya 모델 번들이 없습니다.",
    error: "Laya 모델 로딩에 실패했습니다.",
    unreachable: "laya-service에 연결할 수 없습니다.",
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded bg-black/30 p-4 text-center">
      {status.state === "loading" && <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />}
      <div className="text-sm font-semibold">{text[status.state] ?? status.state}</div>
      {status.message && <div className="max-w-md text-xs text-slate-400">{status.message}</div>}
      {status.state === "missing" && (
        <code className="rounded bg-slate-800 px-2 py-1 text-xs text-amber-300">pnpm fetch-models</code>
      )}
      <div className="text-[11px] text-slate-500">영상·인식·내비 지시·하드 안전 규칙은 Laya 없이도 동작합니다.</div>
    </div>
  );
}
