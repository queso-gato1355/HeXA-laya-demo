// Resource monitor: this dashboard host (Next.js process) + the laya-service host (PC or Pi).
// Both keep a 1 Hz history; clients pass the last timestamps they have and get only newer samples.
import { MetricsSampler, type MetricsSnapshot, SAMPLE_MS } from "@shared/metrics";
import { LAYA_ENDPOINT, endpointIsLocal, forward } from "@/server/laya-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// one sampler per server process, kept across dev HMR reloads
const g = globalThis as unknown as { __dashMetrics?: MetricsSampler };
const sampler = (g.__dashMetrics ??= new MetricsSampler("next-server"));

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const dashboard = sampler.since(Number(q.get("afterDash")) || undefined);
  let laya: MetricsSnapshot[] | null = null;
  let layaError: string | undefined;
  try {
    const r = await forward(`/metrics?after=${Number(q.get("afterLaya")) || 0}`, {}, 1500);
    laya = ((await r.json()) as { samples: MetricsSnapshot[] }).samples;
  } catch (e) {
    layaError = `laya-service(${LAYA_ENDPOINT}) 지표 없음: ${(e as Error).message}`;
  }
  return Response.json(
    { sampleMs: SAMPLE_MS, sameHost: endpointIsLocal(), dashboard, laya, layaError },
    { headers: { "cache-control": "no-store" } },
  );
}
