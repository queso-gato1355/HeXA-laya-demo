// Build deterministic Laya sample states from the demo clip for bench / quantization eval
// (so the Pi needs neither the videos nor the detections).
//   laya-service/node_modules/.bin/tsx --tsconfig tsconfig.json scripts/make-sample-states.ts
import { readFileSync, writeFileSync } from "node:fs";
import { getClip } from "@/data/routes";
import { DetectionsSchema } from "@/lib/data";
import { buildPlan, buildProgress } from "@/lib/route/plan";
import { buildState } from "@/lib/state/buildState";

const CLIP = getClip("frodo_28126"); // bench / quant-eval states always come from the same clip
const { clipId: CLIP_ID, durationS: CLIP_DURATION_S, crossings: CROSSINGS, heading: HEADING, route: ROUTE } = CLIP;
const det = DetectionsSchema.parse(JSON.parse(readFileSync(`public/data/${CLIP_ID}/detections.json`, "utf8")));
const plan = buildPlan(ROUTE);
const ctx = { route: ROUTE, plan, progress: buildProgress(plan, ROUTE), crossings: CROSSINGS, det, heading: HEADING };
const N = 200;
const states = Array.from({ length: N }, (_, i) => {
  const t = Math.round(((i + 0.5) * (CLIP_DURATION_S / N)) * 100) / 100;
  return { t, state: buildState(t, ctx) };
});
writeFileSync("shared/sample-states.json", JSON.stringify({ clipId: CLIP_ID, count: N, states }, null, 1));
console.log(`wrote shared/sample-states.json (${N} states)`);
