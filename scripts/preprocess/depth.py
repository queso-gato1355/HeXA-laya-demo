"""Monocular depth for the demo clip -> depth heatmap video + raw samples for distance/free-space.

  python depth.py <clip_id> [--model scdepthv3|da2] [--hz 3]

scdepthv3 (default, deployable): Hailo Model Zoo ONNX, input 256x320 like the Hailo-8 HEF. Output is
  relative depth (larger = farther).
da2 (comparison only, "배포 불가"): Depth Anything V2 Small (relative). Output is inverse depth
  (larger = closer) and is flipped before colouring. The metric-outdoor checkpoint was tried first but
  is off by ~20x and compresses the far range for this low, wide camera (docs/dataset-notes.md).

Both are normalized with fixed clip-wide 2-98 percentiles, never per frame (no flicker).
Colours: near = blue, far = red (turbo). This is the opposite of the usual "near = warm" convention.

Outputs
  public/data/<clip>/depth.mp4 | depth_da2.mp4    same size / fps / length as front.mp4
  public/data/<clip>/meta.json                    merged per model
  data/<clip>/depth_<model>.npz                   t, raw samples (256x320, float16)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from common import FFMPEG, MODELS, ROOT, pick_device, rover

IN_H, IN_W = 256, 320  # Hailo scdepthv3 input; DA2 output is resampled to the same grid
DA2_ID = "depth-anything/Depth-Anything-V2-Small-hf"


def probe(path: Path) -> tuple[int, int, float, int]:
    err = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True, text=True, errors="replace").stderr
    w, h = map(int, re.search(r", (\d{2,5})x(\d{2,5})", err).groups())
    fps = float(re.search(r"([\d.]+) fps", err).group(1))
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    secs = int(dur[0]) * 3600 + int(dur[1]) * 60 + float(dur[2])
    return w, h, fps, int(round(secs * fps))


def frames(path: Path, w: int, h: int):
    p = subprocess.Popen([FFMPEG, "-loglevel", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         stdout=subprocess.PIPE, bufsize=w * h * 3 * 4)
    n = w * h * 3
    assert p.stdout
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    p.wait()


def writer(path: Path, w: int, h: int, fps: float) -> subprocess.Popen:
    return subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(fps),
         "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-g", "20", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(path)],
        stdin=subprocess.PIPE,
    )


class SCDepthV3:
    name = "scdepthv3"
    inverse = False  # larger = farther

    def __init__(self):
        import onnxruntime as ort

        onnx = MODELS / "scdepthv3" / "scdepthv3.onnx"
        if not onnx.exists():
            sys.exit("models/scdepthv3/scdepthv3.onnx missing - run: pnpm fetch-models")
        provs = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
        self.sess = ort.InferenceSession(str(onnx), providers=provs)
        self.inp = self.sess.get_inputs()[0].name

    def __call__(self, rgb: np.ndarray) -> np.ndarray:
        x = cv2.resize(rgb, (IN_W, IN_H), interpolation=cv2.INTER_AREA).astype(np.float32)
        x = (x - 114.75) / 57.375  # Hailo folds this into the HEF (normalize_in_net)
        x = x.transpose(2, 0, 1)[None]
        logits = self.sess.run(None, {self.inp: x})[0][0, 0]
        # hailo_model_zoo scdepthv3_postprocessing; nominally metres for NYU indoor, not metric outdoors
        return 1.0 / (1.0 / (1.0 + np.exp(-logits)) * 10.0 + 0.009)


class DA2Relative:
    name = DA2_ID
    inverse = True  # relative inverse depth: larger = closer

    def __init__(self):
        import torch
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        self.torch = torch
        self.dev = pick_device()
        self.dtype = torch.float16 if self.dev == "cuda" else torch.float32
        local = MODELS / "depth-anything-v2-small"  # pnpm fetch-models; falls back to the HF cache in models/hf
        src = str(local) if (local / "model.safetensors").exists() else DA2_ID
        self.proc = AutoImageProcessor.from_pretrained(src)
        self.model = AutoModelForDepthEstimation.from_pretrained(src, dtype=self.dtype).to(self.dev).eval()

    def __call__(self, rgb: np.ndarray) -> np.ndarray:
        torch = self.torch
        inputs = self.proc(images=rgb, return_tensors="pt").to(self.dev)
        inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
        with torch.no_grad():
            d = self.model(**inputs).predicted_depth[0].float()
        d = torch.nn.functional.interpolate(d[None, None], size=(IN_H, IN_W), mode="bilinear")[0, 0]
        return d.cpu().numpy()


def colorize(norm01: np.ndarray, w: int, h: int) -> np.ndarray:
    """0 = near -> blue, 1 = far -> red (turbo)."""
    u8 = (np.clip(norm01, 0, 1) * 255).astype(np.uint8)
    u8 = cv2.resize(u8, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.applyColorMap(u8, cv2.COLORMAP_TURBO)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--model", choices=["scdepthv3", "da2"], default="scdepthv3")
    ap.add_argument("--hz", type=float, default=None, help="depth rate; default 3 (scdepthv3) / every frame (da2)")
    a = ap.parse_args()

    pub = ROOT / "public" / "data" / a.clip_id
    work = ROOT / "data" / a.clip_id
    work.mkdir(parents=True, exist_ok=True)
    front = pub / "front.mp4"
    w, h, fps, n_frames = probe(front)
    hz = a.hz if a.hz is not None else (3.0 if a.model == "scdepthv3" else fps)
    net = SCDepthV3() if a.model == "scdepthv3" else DA2Relative()

    # pass 1: run the network at `hz`, keep raw samples
    ts, samples = [], []
    t0 = time.time()
    last_slot = -1
    for i, rgb in enumerate(frames(front, w, h)):
        slot = int(np.floor(i / fps * hz + 1e-6))
        if slot != last_slot:
            last_slot = slot
            ts.append(round(i / fps, 3))
            samples.append(net(rgb).astype(np.float16))
        if i % 100 == 0:
            print(f"\r[{a.model}] frame {i}/{n_frames}  samples={len(samples)}  {time.time() - t0:.0f}s", end="", flush=True)
    print()
    depth = np.stack(samples)
    np.savez_compressed(work / f"depth_{a.model}.npz", t=np.array(ts, np.float32), depth=depth, hz=hz,
                        inverse=net.inverse)

    # fixed normalisation for the whole clip; 0 = near
    lo, hi = (float(v) for v in np.percentile(depth.astype(np.float32), [2, 98]))

    def norm(x: np.ndarray) -> np.ndarray:
        n = (x.astype(np.float32) - lo) / max(hi - lo, 1e-6)
        return 1.0 - n if net.inverse else n

    # pass 2: heatmap video, holding the latest sample between depth ticks
    out = pub / ("depth.mp4" if a.model == "scdepthv3" else "depth_da2.mp4")
    wr = writer(out, w, h, fps)
    assert wr.stdin
    k = 0
    cache: tuple[int, bytes] | None = None
    for i in range(n_frames):
        t = i / fps
        while k + 1 < len(ts) and ts[k + 1] <= t + 1e-6:
            k += 1
        if cache is None or cache[0] != k:
            cache = (k, colorize(norm(depth[k]), w, h).tobytes())
        wr.stdin.write(cache[1])
        if i % 200 == 0:
            print(f"\r[{a.model}] encode {i}/{n_frames}", end="", flush=True)
    wr.stdin.close()
    wr.wait()
    print(f"\nwrote {out}")

    meta_p = pub / "meta.json"
    meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else {}
    meta["hfovDeg"] = rover(a.clip_id)["hfovDeg"]
    meta.update({"fps": fps, "width": w, "height": h, "frames": n_frames})
    entry = {"model": net.name, "depthMode": "relative", "nearM": None, "farM": None, "inverse": net.inverse,
             "normLo": round(lo, 4), "normHi": round(hi, 4), "hz": hz, "input": [IN_H, IN_W], "video": out.name}
    if a.model == "scdepthv3":
        meta.update({**entry, "deployable": True})  # top-level = deployable default depth
    else:
        meta["comparison"] = {**entry, "deployable": False}
    meta_p.write_text(json.dumps(meta, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
