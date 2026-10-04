import type { LayaStatus } from "@shared/state";
import { LAYA_ENDPOINT, PI_PROFILE, decisionHz, endpointIsLocal, forward } from "@/server/laya-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const extra = {
    endpoint: LAYA_ENDPOINT,
    endpointIsLocal: endpointIsLocal(),
    decisionHz: decisionHz(),
    piProfile: { source: PI_PROFILE.source, measured: PI_PROFILE.measured, model: PI_PROFILE.model },
  };
  try {
    const r = await forward("/status", {}, 2500);
    const s = (await r.json()) as LayaStatus;
    return Response.json({ ...s, ...extra }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const s: LayaStatus = {
      state: "unreachable",
      message: `laya-service(${LAYA_ENDPOINT})에 연결할 수 없습니다. pnpm dev로 함께 띄우거나 pnpm dev:laya를 실행하세요. (${(e as Error).message})`,
    };
    return Response.json({ ...s, ...extra }, { headers: { "cache-control": "no-store" } });
  }
}
