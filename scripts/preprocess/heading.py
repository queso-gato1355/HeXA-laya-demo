"""Robot heading for the demo clip: magnetometer (compass) fused with camera yaw -> data/<clip>/heading.json

  python heading.py <clip_id> [--hz 10] [--tau 4]

Why: GPS course is a poor heading source here (1 Hz, 0.1 m quantization, multipath in narrow streets,
undefined while turning on the spot); it disagreed with the camera's real rotation by 20-60 deg at turns.

1. Compass (FrodoBots IMU, ~1 Hz; axes x = up, y = west, z = south): hard-iron offset from a least-squares
   circle fit of the horizontal (y, z) components over the whole ride.
2. Mapping to true heading (sign + offset, which absorbs mounting yaw and magnetic declination) is fitted
   against GPS course on segments where the robot moved > 2.5 m within +-2 s, over the whole ride.
3. Camera yaw rate at `hz` from the front video (optical flow -> homography -> rotation about the vertical
   axis). The dataset gyro is sampled at ~1 Hz, too sparse to integrate.
4. Complementary filter: integrate camera yaw (fast), pull toward the compass with time constant `tau` s
   (slow, no drift).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np

from common import FFMPEG, ROOT, focal_px, rover
from pick_clip import RAW, load_gps


def wrap(a):
    return (np.asarray(a) + 180.0) % 360.0 - 180.0


def circ_interp(tq, t, deg):
    s = np.interp(tq, t, np.sin(np.radians(deg)))
    c = np.interp(tq, t, np.cos(np.radians(deg)))
    return np.degrees(np.arctan2(s, c)) % 360.0


def ensure_imu(part: int, ride: str) -> Path:
    ride_dir = RAW / f"part{part}" / ride
    hit = next(ride_dir.glob("imu_data_*.csv"), None)
    if hit:
        return hit
    from remote_zip import open_part

    zf, _ = open_part(part)
    for info in zf.infolist():
        if ride in info.filename and "imu_data_" in info.filename:
            dest = ride_dir / info.filename.rsplit("/", 1)[-1]
            dest.write_bytes(zf.read(info))
            print(f"fetched {info.filename} ({info.file_size / 1e6:.1f} MB)")
            return dest
    raise SystemExit(f"no imu_data for {ride}")


def load_compass(path: Path) -> np.ndarray:
    rows = []
    with path.open(newline="") as fh:
        for r in csv.DictReader(fh):
            for s in json.loads(r["compass"]):
                rows.append([float(v) for v in s])
    a = np.array(rows)
    return a[np.argsort(a[:, 3])]


def calibrate(comp: np.ndarray, gps: np.ndarray) -> dict:
    y, z = comp[:, 1], comp[:, 2]
    A = np.c_[2 * y, 2 * z, np.ones_like(y)]
    sol = np.linalg.lstsq(A, y**2 + z**2, rcond=None)[0]
    oy, oz = float(sol[0]), float(sol[1])
    radius = np.hypot(y - oy, z - oz)
    phi = np.degrees(np.arctan2(y - oy, z - oz))

    e = np.radians(gps[:, 2] - gps[0, 2]) * 6371000 * math.cos(math.radians(gps[0, 1]))
    n = np.radians(gps[:, 1] - gps[0, 1]) * 6371000
    course = np.full(len(gps), np.nan)
    for i in range(len(gps)):
        j, k = max(0, i - 2), min(len(gps) - 1, i + 2)
        if math.hypot(e[k] - e[j], n[k] - n[j]) > 2.5:
            course[i] = math.degrees(math.atan2(e[k] - e[j], n[k] - n[j]))
    m = ~np.isnan(course)
    best = None
    for sign in (1, -1):
        ph = circ_interp(gps[m, 0], comp[:, 3], sign * phi)
        d = wrap(course[m] - ph)
        off = math.degrees(math.atan2(np.mean(np.sin(np.radians(d))), np.mean(np.cos(np.radians(d)))))
        res = np.abs(wrap(d - off))
        if best is None or np.median(res) < best["residualMedDeg"]:
            best = {"sign": sign, "offsetDeg": round(off, 2), "residualMedDeg": float(np.median(res)),
                    "residualP90Deg": float(np.percentile(res, 90))}
    assert best
    best.update({"hardIron": [round(oy, 1), round(oz, 1)], "radius": round(float(radius.mean()), 1),
                 "radiusRelStd": round(float(radius.std() / radius.mean()), 3), "gpsSamples": int(m.sum()),
                 "residualMedDeg": round(best["residualMedDeg"], 1), "residualP90Deg": round(best["residualP90Deg"], 1)})
    return best


def compass_heading(comp: np.ndarray, cal: dict) -> np.ndarray:
    oy, oz = cal["hardIron"]
    phi = np.degrees(np.arctan2(comp[:, 1] - oy, comp[:, 2] - oz))
    return (cal["sign"] * phi + cal["offsetDeg"]) % 360.0


def camera_yaw(video: Path, hz: float, hfov_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Cumulative camera yaw (deg, + = right) sampled at `hz`."""
    w, h = 512, 288
    raw = subprocess.run([FFMPEG, "-loglevel", "error", "-i", str(video), "-vf", f"fps={hz},scale={w}:{h},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w)
    f = focal_px(w, hfov_deg)
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    Ki = np.linalg.inv(K)
    mask = np.zeros((h, w), np.uint8)
    mask[: int(h * 0.6)] = 255  # above the near road surface; excludes the bumper bars
    yaw = [0.0]
    for a, b in zip(frames[:-1], frames[1:]):
        step = 0.0
        p = cv2.goodFeaturesToTrack(a, 400, 0.01, 6, mask=mask)
        if p is not None and len(p) >= 12:
            q, st, _ = cv2.calcOpticalFlowPyrLK(a, b, p, None)
            ok = st[:, 0] == 1
            if ok.sum() >= 12:
                H, _ = cv2.findHomography(p[ok], q[ok], cv2.RANSAC, 2.0)
                if H is not None:
                    R = Ki @ H @ K
                    # scene moves left when the camera turns right
                    step = -math.degrees(math.atan2(R[0, 2], R[2, 2]))
        yaw.append(yaw[-1] + step)
    return np.arange(len(yaw)) / hz, np.array(yaw)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip_id")
    ap.add_argument("--hz", type=float, default=10.0)
    ap.add_argument("--tau", type=float, default=4.0, help="compass correction time constant (s)")
    a = ap.parse_args()

    gps_meta = json.loads((ROOT / "data" / a.clip_id / "gps.json").read_text(encoding="utf-8"))
    part, ride, t0, dur = gps_meta["part"], gps_meta["ride"], gps_meta["startEpoch"], gps_meta["duration"]
    comp = load_compass(ensure_imu(part, ride))
    gps = load_gps(RAW / f"part{part}" / ride)
    cal = calibrate(comp, gps)
    print("compass calibration:", cal)
    hc = compass_heading(comp, cal)
    tc = comp[:, 3] - t0

    tv, vyaw = camera_yaw(ROOT / "public" / "data" / a.clip_id / "front.mp4", a.hz, rover(a.clip_id)["hfovDeg"])
    alpha = (1.0 / a.hz) / a.tau
    fused = np.empty_like(vyaw)
    fused[0] = circ_interp(tv[0], tc, hc)
    for k in range(1, len(tv)):
        pred = fused[k - 1] + (vyaw[k] - vyaw[k - 1])
        fused[k] = (pred + alpha * wrap(circ_interp(tv[k], tc, hc) - pred)) % 360.0
    compass_at = circ_interp(tv, tc, hc)
    diff = np.abs(wrap(fused - compass_at))

    out = {
        "clipId": a.clip_id,
        "source": "compass+camera-yaw",
        "hz": a.hz,
        "tauS": a.tau,
        "calibration": cal,
        "fusedVsCompassDeg": {"median": round(float(np.median(diff)), 1), "p90": round(float(np.percentile(diff, 90)), 1)},
        "t": [round(float(x), 2) for x in tv if x <= dur + 1e-6],
        "deg": [round(float(x), 1) for x, tt in zip(fused, tv) if tt <= dur + 1e-6],
        "compass": [{"t": round(float(t), 2), "deg": round(float(d), 1)} for t, d in zip(tc, hc) if -2 <= t <= dur + 2],
    }
    p = ROOT / "data" / a.clip_id / "heading.json"
    p.write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {p}: {len(out['t'])} samples, fused vs compass median {out['fusedVsCompassDeg']['median']} deg")


if __name__ == "__main__":
    main()
