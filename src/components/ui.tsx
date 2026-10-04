// Small shared UI bits.
import type { RiskLevel } from "@shared/state";

export const RISK_COLORS: Record<RiskLevel, string> = {
  0: "#34d399",
  1: "#facc15",
  2: "#fb923c",
  3: "#f43f5e",
};

export function riskColor(level: RiskLevel | null | undefined, fallback = "#64748b"): string {
  return level === null || level === undefined ? fallback : RISK_COLORS[level];
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] text-slate-300">
      <input type="checkbox" className="accent-sky-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Badge({ children, color = "#334155", title }: { children: React.ReactNode; color?: string; title?: string }) {
  return (
    <span className="chip text-white" style={{ background: color }} title={title}>
      {children}
    </span>
  );
}

/** video boxes are capped by viewport height so the whole dashboard fits one screen at 1440p+ */
export const videoBoxStyle = (w: number, h: number) => ({
  aspectRatio: `${w} / ${h}`,
  width: `min(100%, calc(var(--video-vh, 31vh) * ${w} / ${h}))`,
  marginInline: "auto",
});

/** turbo colormap stops: near (blue) -> far (red) */
export const TURBO_GRADIENT =
  "linear-gradient(90deg,#30123b,#4145ab,#4675ed,#39a2fc,#1bcfd4,#24eca6,#61fc6c,#a4fc3b,#d1e834,#f3c63a,#fe9b2d,#f36315,#d93806,#b11901,#7a0402)";
