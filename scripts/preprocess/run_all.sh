#!/usr/bin/env bash
# Full offline pipeline for one clip (front.mp4 must already exist: pick_clip.py cut).
#   scripts/preprocess/run_all.sh <clip_id> [--no-compare]
# Order: depth -> detect (default camera) -> calibrate camera from detections/compass -> distances with the
# calibrated camera -> free space -> heading (compass + camera yaw) -> src/data/routes/<clip>.ts
set -euo pipefail
cd "$(dirname "$0")"
CLIP="${1:?usage: run_all.sh <clip_id> [--no-compare]}"
if [ -x .venv/Scripts/python.exe ]; then PY=.venv/Scripts/python.exe; else PY=.venv/bin/python; fi
[ -x "$PY" ] || { echo "venv missing: (cd scripts/preprocess && uv sync -p 3.12)"; exit 1; }

echo "== [1/8] depth (SCDepthV3, Hailo-8 input 256x320, 3 Hz)"
"$PY" -u depth.py "$CLIP" --model scdepthv3
if [ "${2:-}" != "--no-compare" ]; then
  echo "== [2/8] depth comparison (Depth Anything V2 Small, not deployable)"
  "$PY" -u depth.py "$CLIP" --model da2
else
  echo "== [2/8] depth comparison skipped"
fi
echo "== [3/8] detection + tracking (YOLO11n 640, ByteTrack)"
"$PY" -u detect.py "$CLIP"
echo "== [4/8] camera calibration -> public/data/$CLIP/camera.json"
"$PY" -u calibrate_camera.py "$CLIP"
echo "== [5/8] distances with the calibrated camera"
"$PY" -u detect.py "$CLIP" --distances-only
echo "== [6/8] free space"
"$PY" -u freespace.py "$CLIP"
echo "== [7/8] heading (compass + camera yaw)"
"$PY" -u heading.py "$CLIP"
echo "== [8/8] src/data/routes/$CLIP.ts"
"$PY" -u make_route.py "$CLIP"
echo "done: public/data/$CLIP"
