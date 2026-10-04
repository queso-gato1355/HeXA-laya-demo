"""Free-space per zone (left / center / right of the bottom third) -> detections.json `freeSpace`.

  python freespace.py <clip_id>

Relative depth has no metres, so "near" cannot be a fixed 1.5 m threshold. Instead each pixel is
compared with its own clip-wide median depth (mostly road, plus static parts of the rover such as
the bumper bars): a pixel is an obstacle when it is clearly closer than usual (< OBST_RATIO x median).
Detected objects with an estimated distance < NEAR_M overlapping a zone also count as obstacles.

zone ratio < OPEN_MAX  -> "open"
zone ratio < PART_MAX  -> "partial"
otherwise              -> "blocked"
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from common import ROOT

OBST_RATIO = 0.8
NEAR_M = 1.5
OPEN_MAX, PART_MAX = 0.10, 0.30


def zone_ratios(depth: np.ndarray, background: np.ndarray) -> list[float]:
    h, w = depth.shape
    y0 = h * 2 // 3
    obst = depth[y0:] < background[y0:] * OBST_RATIO
    return [float(obst[:, w * i // 3: w * (i + 1) // 3].mean()) for i in range(3)]


def classify(r: float) -> str:
    return "open" if r < OPEN_MAX else ("partial" if r < PART_MAX else "blocked")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    a = ap.parse_args()
    pub = ROOT / "public" / "data" / a.clip_id
    work = ROOT / "data" / a.clip_id
    det_p = pub / "detections.json"
    det = json.loads(det_p.read_text(encoding="utf-8"))
    w, h = det["width"], det["height"]

    dz = np.load(work / "depth_scdepthv3.npz")
    d_t, d_maps = dz["t"], dz["depth"].astype(np.float32)
    background = np.median(d_maps, axis=0)
    ratios = np.array([zone_ratios(d, background) for d in d_maps])

    k = 0
    counts = {"open": 0, "partial": 0, "blocked": 0}
    for fr in det["frames"]:
        while k + 1 < len(d_t) and d_t[k + 1] <= fr["t"] + 1e-6:
            k += 1
        zr = list(ratios[k])
        for o in fr["objects"]:
            if o["distM"] >= NEAR_M:
                continue
            x1, y1, x2, y2 = o["bbox"]
            if y2 < h * 2 / 3:
                continue
            for zi in range(3):
                zx1, zx2 = w * zi / 3, w * (zi + 1) / 3
                overlap = max(0.0, min(x2, zx2) - max(x1, zx1)) / (zx2 - zx1)
                zr[zi] = max(zr[zi], overlap)
        fs = {"left": classify(zr[0]), "center": classify(zr[1]), "right": classify(zr[2])}
        fr["freeSpace"] = fs
        for v in fs.values():
            counts[v] += 1
    det["freeSpaceMethod"] = {"obstRatio": OBST_RATIO, "nearM": NEAR_M, "openMax": OPEN_MAX, "partialMax": PART_MAX,
                              "depth": "scdepthv3-relative-vs-clip-median"}
    det_p.write_text(json.dumps(det, separators=(",", ":")), encoding="utf-8")
    print("zone states:", counts)


if __name__ == "__main__":
    main()
