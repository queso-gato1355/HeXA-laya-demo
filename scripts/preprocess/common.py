"""Shared paths and helpers for the preprocessing scripts.

All model weights live under <repo>/models so nothing lands in user-level caches
(HF_HOME and the Ultralytics weights dir are pointed there before any import).
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
MODELS.mkdir(exist_ok=True)

os.environ.setdefault("HF_HOME", str(MODELS / "hf"))
os.environ.setdefault("YOLO_CONFIG_DIR", str(MODELS / "ultralytics"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import imageio_ffmpeg  # noqa: E402

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

GPU_MEMORY_FRACTION = 0.6  # leave room for the dev server / Laya on the same GPU


def pick_device() -> str:
    import torch

    if torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(GPU_MEMORY_FRACTION)
        return "cuda"
    return "cpu"


def yolo_weights() -> Path:
    """Download yolo11n.pt into models/ once."""
    p = MODELS / "yolo11n.pt"
    if not p.exists():
        import urllib.request

        url = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt"
        print(f"downloading {url}", flush=True)
        urllib.request.urlretrieve(url, p)
    return p


CAMERA_KEYS = ("cameraHeightM", "cameraPitchDeg", "hfovDeg")


def rover(clip_id: str | None = None) -> dict:
    """Rover profile (src/config/rover.json, also read by src/config/rover.ts). With a clip id, the clip's
    calibrated camera (public/data/<clip>/camera.json from calibrate_camera.py) overrides the camera fields:
    different FrodoBots units mount the camera differently."""
    import json

    prof = json.loads((ROOT / "src" / "config" / "rover.json").read_text(encoding="utf-8"))
    if clip_id:
        cam_p = ROOT / "public" / "data" / clip_id / "camera.json"
        if cam_p.exists():
            cam = json.loads(cam_p.read_text(encoding="utf-8"))
            prof.update({k: cam[k] for k in CAMERA_KEYS if k in cam})
    return prof


def focal_px(width: int, hfov_deg: float) -> float:
    import math

    return (width / 2) / math.tan(math.radians(hfov_deg) / 2)


def ground_distance(y_px, height: int, width: int, prof: dict | None = None):
    """Flat-ground distance (m) of image row y for a pinhole camera at cameraHeightM / cameraPitchDeg.

    Returns inf for rows at or above the horizon. Works on scalars and numpy arrays.
    """
    import numpy as np

    prof = prof or rover()
    f = focal_px(width, prof["hfovDeg"])
    down = np.radians(-prof["cameraPitchDeg"]) + np.arctan((np.asarray(y_px, dtype=np.float64) - height / 2) / f)
    with np.errstate(divide="ignore"):
        d = np.where(down > 1e-3, prof["cameraHeightM"] / np.tan(np.maximum(down, 1e-3)), np.inf)
    return d
