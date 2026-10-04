// Shapes of the preprocessing outputs in public/data/<clip>/ and their loader.
import { z } from "zod";

const Zone = z.enum(["open", "partial", "blocked"]);

export const DetObjectSchema = z.object({
  id: z.number(),
  cls: z.string(),
  conf: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** estimated, never measured */
  distM: z.number(),
  distSource: z.enum(["depth", "pinhole", "ground"]),
  depthRank: z.enum(["near", "mid", "far"]).optional(),
});
export type DetObject = z.infer<typeof DetObjectSchema>;

export const DetFrameSchema = z.object({
  t: z.number(),
  freeSpace: z.object({ left: Zone, center: Zone, right: Zone }).optional(),
  objects: z.array(DetObjectSchema),
});
export type DetFrame = z.infer<typeof DetFrameSchema>;

export const DetectionsSchema = z.object({
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  model: z.string().optional(),
  frames: z.array(DetFrameSchema),
});
export type Detections = z.infer<typeof DetectionsSchema>;

const DepthEntry = z.object({
  model: z.string(),
  depthMode: z.enum(["metric", "relative"]),
  nearM: z.number().nullable(),
  farM: z.number().nullable(),
  hz: z.number(),
  video: z.string(),
  deployable: z.boolean(),
});

export const MetaSchema = DepthEntry.extend({
  hfovDeg: z.number(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  frames: z.number(),
  comparison: DepthEntry.optional(),
});
export type ClipMeta = z.infer<typeof MetaSchema>;

/** public/data/<clip>/camera.json (scripts/preprocess/calibrate_camera.py) */
export const CameraSchema = z.object({
  cameraHeightM: z.number(),
  cameraPitchDeg: z.number(),
  hfovDeg: z.number(),
  source: z.record(z.string(), z.string()).optional(),
});
export type ClipCamera = z.infer<typeof CameraSchema>;

export interface ClipData {
  clipId: string;
  meta: ClipMeta;
  det: Detections;
  /** null = not calibrated, use the global rover profile */
  camera: ClipCamera | null;
}

export async function loadClip(clipId: string): Promise<ClipData> {
  const base = `/data/${clipId}`;
  const [meta, det, camera] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json()),
    fetch(`${base}/detections.json`).then((r) => r.json()),
    fetch(`${base}/camera.json`).then((r) => (r.ok ? r.json() : null), () => null),
  ]);
  const cam = CameraSchema.safeParse(camera);
  return { clipId, meta: MetaSchema.parse(meta), det: DetectionsSchema.parse(det), camera: cam.success ? cam.data : null };
}

export function frameAt(det: Detections, t: number): DetFrame {
  const i = Math.max(0, Math.min(det.frames.length - 1, Math.round(t * det.fps)));
  return det.frames[i];
}
