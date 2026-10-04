"""Object detection + tracking for the demo clip -> public/data/<clip>/detections.json

  python detect.py <clip_id> [--imgsz 640]

YOLO11n (Ultralytics, AGPL-3.0) at 640 like the Hailo-8 yolov11n HEF, ByteTrack ids.

Distance (always an *estimate*, shown as such in the UI):
  pinhole  d = f * H_class / h_px, f from the rover HFOV         (default)
  ground   flat-ground distance of the bbox bottom row            (bbox cut off by the bottom edge,
                                                                   where h_px is truncated)
Relative depth (SCDepthV3) is not metric, so it only gives a near/mid/far rank per object.
Run depth.py first; freespace.py afterwards fills `freeSpace`.
"""

from __future__ import annotations

import argparse
import json
import time

import numpy as np

from common import ROOT, focal_px, ground_distance, pick_device, rover, yolo_weights
from depth import frames, probe

# COCO ids -> names used in the dashboard
CLASSES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 9: "traffic light",
           10: "fire hydrant", 11: "stop sign", 13: "bench", 16: "dog"}
# typical object heights (m) for the pinhole estimate
HEIGHT_M = {"person": 1.7, "car": 1.5, "bicycle": 1.1, "dog": 0.5, "motorcycle": 1.1, "bus": 3.0, "truck": 2.5,
            "traffic light": 0.9, "stop sign": 0.75, "bench": 0.8, "fire hydrant": 0.6}


def bottom_center_patch(depth: np.ndarray, box, w: int, h: int) -> np.ndarray:
    """Depth samples in the bottom-centre 30% of a bbox (depth grid is 256x320)."""
    dh, dw = depth.shape
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    cx1, cx2 = x1 + bw * 0.35, x2 - bw * 0.35
    cy1, cy2 = y2 - bh * 0.3, y2
    gx1, gx2 = int(cx1 / w * dw), max(int(cx2 / w * dw), int(cx1 / w * dw) + 1)
    gy1, gy2 = int(cy1 / h * dh), max(int(cy2 / h * dh), int(cy1 / h * dh) + 1)
    return depth[max(gy1, 0):min(gy2, dh), max(gx1, 0):min(gx2, dw)]


def estimate_distance(bbox, cls: str, w: int, h: int, prof: dict) -> tuple[float, str]:
    """pinhole from the class height, or flat-ground distance of the bottom edge when the box is cut off"""
    x1, y1, x2, y2 = bbox
    if y2 >= h - 3:
        return float(ground_distance(y2, h, w, prof)), "ground"
    return focal_px(w, prof["hfovDeg"]) * HEIGHT_M[cls] / max(y2 - y1, 1.0), "pinhole"


def recompute_distances(clip_id: str) -> None:
    """Re-estimate distM/distSource of an existing detections.json with the clip's current camera."""
    p = ROOT / "public" / "data" / clip_id / "detections.json"
    det = json.loads(p.read_text(encoding="utf-8"))
    prof = rover(clip_id)
    for fr in det["frames"]:
        for o in fr["objects"]:
            d, src = estimate_distance(o["bbox"], o["cls"], det["width"], det["height"], prof)
            o["distM"], o["distSource"] = round(min(d, 99.0), 1), src
    det["hfovDeg"] = prof["hfovDeg"]
    p.write_text(json.dumps(det, separators=(",", ":")), encoding="utf-8")
    print(f"recomputed distances in {p} (height {prof['cameraHeightM']} m, pitch {prof['cameraPitchDeg']}, hfov {prof['hfovDeg']})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.3)
    ap.add_argument("--distances-only", action="store_true", help="only re-estimate distances (after calibrate_camera.py)")
    a = ap.parse_args()
    if a.distances_only:
        recompute_distances(a.clip_id)
        return

    from ultralytics import YOLO

    pub = ROOT / "public" / "data" / a.clip_id
    work = ROOT / "data" / a.clip_id
    front = pub / "front.mp4"
    w, h, fps, n_frames = probe(front)
    prof = rover(a.clip_id)

    dz = np.load(work / "depth_scdepthv3.npz")
    d_t, d_maps = dz["t"], dz["depth"].astype(np.float32)

    dev = pick_device()
    model = YOLO(str(yolo_weights()))
    out_frames = []
    t0 = time.time()
    k = 0
    for i, rgb in enumerate(frames(front, w, h)):
        t = i / fps
        while k + 1 < len(d_t) and d_t[k + 1] <= t + 1e-6:
            k += 1
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        r = model.track(bgr, persist=True, tracker="bytetrack.yaml", imgsz=a.imgsz, conf=a.conf,
                        classes=list(CLASSES), device=dev, half=dev == "cuda", verbose=False)[0]
        objs = []
        if r.boxes is not None and len(r.boxes):
            xyxy = r.boxes.xyxy.cpu().numpy()
            cls = r.boxes.cls.cpu().numpy().astype(int)
            conf = r.boxes.conf.cpu().numpy()
            ids = r.boxes.id.cpu().numpy().astype(int) if r.boxes.id is not None else np.full(len(cls), -1)
            for b, c, cf, tid in zip(xyxy, cls, conf, ids):
                name = CLASSES[int(c)]
                x1, y1, x2, y2 = (float(v) for v in b)
                dist, src = estimate_distance((x1, y1, x2, y2), name, w, h, prof)
                patch = bottom_center_patch(d_maps[k], (x1, y1, x2, y2), w, h)
                dmed = float(np.median(patch)) if patch.size else float("nan")
                objs.append({
                    "id": int(tid), "cls": name, "conf": round(float(cf), 2),
                    "bbox": [round(x1), round(y1), round(x2), round(y2)],
                    "distM": round(min(dist, 99.0), 1), "distSource": src, "_d": dmed,
                })
        out_frames.append({"t": round(t, 2), "objects": objs})
        if i % 100 == 0:
            print(f"\r[detect] {i}/{n_frames}  {time.time() - t0:.0f}s", end="", flush=True)
    print()

    # near/mid/far = clip-wide terciles of the objects' own relative depth
    all_d = np.array([o["_d"] for fr in out_frames for o in fr["objects"] if np.isfinite(o["_d"])])
    lo_q, hi_q = (float(v) for v in np.percentile(all_d, [33, 66])) if len(all_d) else (0.0, 0.0)
    for fr in out_frames:
        for o in fr["objects"]:
            d = o.pop("_d")
            o["depthRank"] = "near" if d < lo_q else ("mid" if d < hi_q else "far")

    out = {"fps": fps, "width": w, "height": h, "model": "yolo11n", "imgsz": a.imgsz, "tracker": "bytetrack",
           "hfovDeg": prof["hfovDeg"], "frames": out_frames}
    (pub / "detections.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    n_obj = sum(len(fr["objects"]) for fr in out_frames)
    print(f"wrote {pub / 'detections.json'}: {len(out_frames)} frames, {n_obj} boxes")


if __name__ == "__main__":
    main()
