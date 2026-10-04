// One HTTP request per criterion -> laya-service POST /criteria/:name (one systemOne call, one question).
// ?profile=pi simulates the Raspberry Pi: each answer is held back to the Pi p50 latency, serially.
import { getCriterion } from "@shared/criteria/index";
import { CriterionRequestSchema, type CriterionResponse } from "@shared/state";
import { PI_PROFILE, endpointIsLocal, forward, piSerialized, sleep } from "@/server/laya-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ criterion: string }> }) {
  const { criterion } = await ctx.params;
  if (!getCriterion(criterion)) return Response.json({ error: `unknown criterion: ${criterion}` }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = CriterionRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });

  const piMode = new URL(req.url).searchParams.get("profile") === "pi" && endpointIsLocal();

  const call = async () => {
    const t0 = Date.now();
    let r: Response;
    try {
      r = await forward(`/criteria/${criterion}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
    } catch (e) {
      return Response.json({ error: `laya-service 연결 실패: ${(e as Error).message}` }, { status: 502 });
    }
    const data = (await r.json()) as CriterionResponse & { error?: string };
    if (!r.ok) return Response.json(data, { status: r.status });
    if (piMode) {
      const target = PI_PROFILE.p50Ms[criterion] ?? 0;
      const delay = Math.max(0, target - (data.cached ? 0 : data.computeMs));
      await sleep(delay);
      data.simulatedDelayMs = delay;
      data.latencyMs = Date.now() - t0;
    }
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  };

  return piMode ? piSerialized(call) : call();
}
