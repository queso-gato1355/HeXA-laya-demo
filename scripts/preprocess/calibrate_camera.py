"""Estimate the front camera's pitch, height and HFOV from the clip itself -> src/config/rover.json

  python calibrate_camera.py <clip_id> [--car-height 1.5] [--write-global]

Writes public/data/<clip>/camera.json (read by the dashboard and by common.rover(clip_id)). Any value without
enough evidence in the clip falls back to src/config/rover.json; the file records which cue each value came from.

FrodoBots publishes no camera calibration, and the first guess (0.3 m, -4 deg, HFOV 100) put the horizon
far too high and every ground distance ~8x too short. Three cues, all from data we already have:

1. Horizon row: median intersection of left- and right-leaning road edges (Canny + Hough on the lower
   image, 1 frame/s). On flat ground the vanishing point lies on the horizon -> pitch (given HFOV).
2. Camera height: the horizon cuts every object at camera height, so for cars that straddle it
   height = car_height x (bottom - horizon) / (bottom - top). Independent of the focal length.
3. HFOV from rotation: while the robot turns, far scene points shift sideways by ~f x d(yaw) pixels. The
   median ratio of the image shift (optical flow, central band) to the compass yaw change over 2 s windows
   with > 8 deg of rotation gives the focal length f. (Matching car bbox heights against ground contact was
   tried too, but its error is flat from 60 to 120 deg, so it cannot pin the focal length down.)
Only central, unclipped, confident car boxes are used for the height (full height visible).
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess

import cv2
import numpy as np

from common import FFMPEG, ROOT


def horizon_row(video, w: int, h: int) -> tuple[float, int]:
    raw = subprocess.run([FFMPEG, "-loglevel", "error", "-i", str(video), "-vf", "fps=1,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w)
    rows = []
    for g in frames:
        e = cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 60, 160)
        e[: int(h * 0.45)] = 0
        e[int(h * 0.85):] = 0  # rover bumper bars
        lines = cv2.HoughLinesP(e, 1, np.pi / 180, 60, minLineLength=60, maxLineGap=10)
        if lines is None:
            continue
        segs = [l.reshape(-1).astype(float) for l in lines]
        segs = [s for s in segs if 15 < abs(math.degrees(math.atan2(s[3] - s[1], s[2] - s[0]))) < 75]
        pts = []
        for i in range(len(segs)):
            for j in range(i + 1, len(segs)):
                x1, y1, x2, y2 = segs[i]
                x3, y3, x4, y4 = segs[j]
                s1 = (y2 - y1) / (x2 - x1 + 1e-9)
                s2 = (y4 - y3) / (x4 - x3 + 1e-9)
                if s1 * s2 >= 0:
                    continue
                x = (y3 - y1 + s1 * x1 - s2 * x3) / (s1 - s2)
                y = y1 + s1 * (x - x1)
                if 0 < x < w and 0 < y < h:
                    pts.append(y)
        if len(pts) >= 3:
            rows.append(float(np.median(pts)))
    return (float(np.median(rows)) if rows else float("nan")), len(rows)


def focal_from_rotation(clip_id: str, w: int, h: int) -> tuple[float, int]:
    from heading import calibrate, circ_interp, compass_heading, ensure_imu, load_compass, wrap
    from pick_clip import RAW, load_gps

    gm = json.loads((ROOT / "data" / clip_id / "gps.json").read_text(encoding="utf-8"))
    comp = load_compass(ensure_imu(gm["part"], gm["ride"]))
    hc = compass_heading(comp, calibrate(comp, load_gps(RAW / f"part{gm['part']}" / gm["ride"])))
    tc = comp[:, 3] - gm["startEpoch"]
    sw, sh, fps = w // 2, h // 2, 10
    raw = subprocess.run([FFMPEG, "-loglevel", "error", "-i", str(ROOT / "public" / "data" / clip_id / "front.mp4"),
                          "-vf", f"fps={fps},scale={sw}:{sh},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, sh, sw)
    mask = np.zeros((sh, sw), np.uint8)
    mask[: int(sh * 0.6)] = 255
    shift = [0.0]
    for a, b in zip(frames[:-1], frames[1:]):
        step = 0.0
        p = cv2.goodFeaturesToTrack(a, 400, 0.01, 6, mask=mask)
        if p is not None and len(p) >= 12:
            q, st, _ = cv2.calcOpticalFlowPyrLK(a, b, p, None)
            ok = st[:, 0] == 1
            central = np.abs(p[ok][:, 0, 0] - sw / 2) < sw * 0.3
            if central.sum() >= 8:
                step = -float(np.median((q[ok] - p[ok])[central][:, 0, 0])) * (w / sw)
        shift.append(shift[-1] + step)
    tv = np.arange(len(shift)) / fps
    ratios = []
    for t0 in np.arange(0, tv[-1] - 2, 1.0):
        dyaw = float(wrap(circ_interp(t0 + 2, tc, hc) - circ_interp(t0, tc, hc)))
        if abs(dyaw) > 8:
            dpx = np.interp(t0 + 2, tv, shift) - np.interp(t0, tv, shift)
            ratios.append(dpx / math.radians(dyaw))
    return float(np.median(ratios)), len(ratios)


OBJ_HEIGHT_M = {"car": 1.5, "person": 1.7}
MIN_VP_FRAMES = 5
MIN_STRADDLE = 40
MIN_TURN_WINDOWS = 8
# plausibility bounds for a small sidewalk robot; outside them the cue is considered broken (e.g. curved
# park paths fool the vanishing point, large vans passing close fool the rotation cue)
HFOV_RANGE = (80.0, 125.0)
PITCH_RANGE = (-8.0, 10.0)
HEIGHT_RANGE = (0.2, 1.3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--car-height", type=float, default=OBJ_HEIGHT_M["car"])
    ap.add_argument("--write-global", action="store_true", help="also update src/config/rover.json")
    a = ap.parse_args()
    OBJ_HEIGHT_M["car"] = a.car_height
    pub = ROOT / "public" / "data" / a.clip_id
    det = json.loads((pub / "detections.json").read_text(encoding="utf-8"))
    w, h = det["width"], det["height"]
    default = json.loads((ROOT / "src" / "config" / "rover.json").read_text(encoding="utf-8"))
    source: dict[str, str] = {}

    # focal length (HFOV) from rotation; fall back to the global profile without enough turning
    try:
        f, n_win = focal_from_rotation(a.clip_id, w, h)
    except Exception as e:  # no IMU for this ride, etc.
        f, n_win = float("nan"), 0
        print(f"rotation cue unavailable: {e}")
    hfov_est = math.degrees(2 * math.atan((w / 2) / f)) if math.isfinite(f) else float("nan")
    if n_win >= MIN_TURN_WINDOWS and HFOV_RANGE[0] <= hfov_est <= HFOV_RANGE[1]:
        hfov = hfov_est
        source["hfovDeg"] = f"rotation ({n_win} windows)"
    elif n_win >= MIN_TURN_WINDOWS:
        hfov = float(default["hfovDeg"])
        f = (w / 2) / math.tan(math.radians(hfov) / 2)
        source["hfovDeg"] = f"default (rotation gave {hfov_est:.0f} deg, outside {HFOV_RANGE})"
    else:
        hfov = float(default["hfovDeg"])
        f = (w / 2) / math.tan(math.radians(hfov) / 2)
        source["hfovDeg"] = f"default (only {n_win} turning windows)"

    # pitch from the horizon (road vanishing points)
    vh, n_vp = horizon_row(pub / "front.mp4", w, h)
    pitch_est = math.degrees(math.atan((vh - h / 2) / f)) if math.isfinite(vh) else float("nan")
    if n_vp >= MIN_VP_FRAMES and PITCH_RANGE[0] <= pitch_est <= PITCH_RANGE[1]:
        pitch = pitch_est
        source["cameraPitchDeg"] = f"vanishing points ({n_vp} frames)"
    elif n_vp >= MIN_VP_FRAMES:
        pitch = float(default["cameraPitchDeg"])
        vh = h / 2 + f * math.tan(math.radians(pitch))
        source["cameraPitchDeg"] = f"default (vanishing points gave {pitch_est:+.1f} deg, outside {PITCH_RANGE})"
    else:
        pitch = float(default["cameraPitchDeg"])
        vh = h / 2 + f * math.tan(math.radians(pitch))
        source["cameraPitchDeg"] = f"default (only {n_vp} frames with a vanishing point)"

    # height: the horizon cuts objects at camera height (cars 1.5 m, pedestrians 1.7 m)
    est = []
    for fr in det["frames"]:
        for o in fr["objects"]:
            x1, y1, x2, y2 = o["bbox"]
            if o["cls"] in OBJ_HEIGHT_M and o["conf"] >= 0.5 and y2 < h - 3 and y1 > 2 and abs((x1 + x2) / 2 - w / 2) < w * 0.3 and y1 < vh < y2:
                est.append(OBJ_HEIGHT_M[o["cls"]] * (y2 - vh) / (y2 - y1))
    h_est = float(np.median(est)) if est else float("nan")
    if len(est) >= MIN_STRADDLE and HEIGHT_RANGE[0] <= h_est <= HEIGHT_RANGE[1]:
        cam_h = h_est
        source["cameraHeightM"] = f"horizon crossing ({len(est)} cars/pedestrians)"
    elif len(est) >= MIN_STRADDLE:
        cam_h = float(default["cameraHeightM"])
        source["cameraHeightM"] = f"default (horizon crossing gave {h_est:.2f} m, outside {HEIGHT_RANGE})"
    else:
        cam_h = float(default["cameraHeightM"])
        source["cameraHeightM"] = f"default (only {len(est)} objects straddle the horizon)"

    result = {"cameraHeightM": round(cam_h, 2), "cameraPitchDeg": round(pitch, 1), "hfovDeg": round(hfov)}
    for k, v in result.items():
        print(f"{k:15s} {v:7}  <- {source[k]}")
    cam_p = pub / "camera.json"
    cam_p.write_text(json.dumps({**result, "source": source}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {cam_p}")
    if a.write_global:
        p = ROOT / "src" / "config" / "rover.json"
        prof = json.loads(p.read_text(encoding="utf-8"))
        prof.update(result)
        p.write_text(json.dumps(prof, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"updated {p}")


if __name__ == "__main__":
    main()
