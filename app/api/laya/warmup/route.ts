import { forward } from "@/server/laya-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** one dummy Laya call so the first real decision is not a cold start */
export async function POST() {
  try {
    const r = await forward("/warmup", { method: "POST" }, 60000);
    return Response.json(await r.json(), { status: r.status });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
