"""Pick a 60-120 s demo clip from the FrodoBots-2K rides fetched by fetch_rides.py.

  python pick_clip.py rank  [--part 10] [--top 15]
      GPS-only ranking: distance, turns, stationary ratio -> data/candidates.json
  python pick_clip.py peds  [--part 10] [--top 6]
      downloads the front video for the top-N windows, samples frames with YOLO and
      adds a pedestrian bonus -> data/candidates.json (re-sorted)
  python pick_clip.py cut   [--part 10] [--rank 0 | --ride R --start S --dur D] [--clip-id ID]
      cuts public/data/<clip_id>/front.mp4 and writes data/<clip_id>/gps.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common import FFMPEG, ROOT, pick_device, yolo_weights

RAW = ROOT / "data" / "raw"
CANDIDATES = ROOT / "data" / "candidates.json"
SEG_RE = re.compile(r"(\d{17})\.ts$")


# ---------------------------------------------------------------- geo
def haversine(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def ang_diff(a: float, b: float) -> float:
    return (b - a + 540) % 360 - 180


# ---------------------------------------------------------------- data
def load_gps(ride_dir: Path) -> np.ndarray:
    f = next(ride_dir.glob("gps_data_*.csv"))
    rows = []
    with f.open(newline="") as fh:
        for r in csv.DictReader(fh):
            try:
                lat, lon, ts = float(r["latitude"]), float(r["longitude"]), float(r["timestamp"])
            except (KeyError, ValueError):
                continue
            if lat == 0 and lon == 0:
                continue
            rows.append((ts / 1000.0 if ts > 1e11 else ts, lat, lon))  # ms epoch -> s
    a = np.array(sorted(rows))
    if len(a):
        _, keep = np.unique(a[:, 0], return_index=True)
        a = a[keep]
    return a


def front_range(ride_dir: Path) -> tuple[float, float] | None:
    f = next(ride_dir.glob("front_camera_timestamps_*.csv"), None)
    if not f:
        return None
    ts = np.loadtxt(f, delimiter=",", skiprows=1, usecols=1, ndmin=1)
    return (float(ts.min()), float(ts.max())) if len(ts) else None


def window_metrics(g: np.ndarray, t0: float, dur: float) -> dict | None:
    m = (g[:, 0] >= t0) & (g[:, 0] <= t0 + dur)
    w = g[m]
    if len(w) < dur * 0.8:
        return None
    if np.max(np.diff(w[:, 0])) > 3.0:
        return None
    # 3-point moving average to tame 1 Hz GPS jitter
    k = np.ones(3) / 3
    lat = np.convolve(w[:, 1], k, mode="same")
    lon = np.convolve(w[:, 2], k, mode="same")
    lat[[0, -1]], lon[[0, -1]] = w[[0, -1], 1], w[[0, -1], 2]
    step = np.array([haversine(lat[i], lon[i], lat[i + 1], lon[i + 1]) for i in range(len(w) - 1)])
    dt = np.diff(w[:, 0])
    speed = step / np.maximum(dt, 1e-3)
    dist = float(step.sum())
    stationary = float(np.mean(speed < 0.2))
    # bearings between points at least 3 m apart; count turns > 55 deg within ~12 s
    heads, ht = [], []
    j = 0
    for i in range(1, len(w)):
        if haversine(lat[j], lon[j], lat[i], lon[i]) >= 3.0:
            heads.append(bearing(lat[j], lon[j], lat[i], lon[i]))
            ht.append(w[i, 0])
            j = i
    total_turn, turns = 0.0, 0
    i = 0
    while i < len(heads) - 1:
        total_turn += abs(ang_diff(heads[i], heads[i + 1]))
        i += 1
    i = 0
    while i < len(heads):
        k2 = i
        while k2 + 1 < len(heads) and ht[k2 + 1] - ht[i] <= 12:
            k2 += 1
        if abs(ang_diff(heads[i], heads[k2])) >= 55:
            turns += 1
            while i < len(heads) and ht[i] <= ht[k2]:
                i += 1
        else:
            i += 1
    return {
        "dist_m": round(dist, 1),
        "mean_speed": round(dist / dur, 2),
        "stationary": round(stationary, 2),
        "turns": turns,
        "total_turn_deg": round(total_turn),
    }


def score(m: dict) -> float:
    return (
        min(m["mean_speed"], 1.2) * 2.0
        + min(m["turns"], 3) * 1.5
        - m["stationary"] * 4.0
        + m.get("ped_score", 0.0)
    )


# ---------------------------------------------------------------- commands
def cmd_rank(part: int, top: int) -> None:
    cands = []
    rides = sorted((RAW / f"part{part}").glob("ride_*"))
    for rd in rides:
        try:
            g = load_gps(rd)
        except StopIteration:
            continue
        fr = front_range(rd)
        if len(g) < 60 or not fr:
            continue
        best = None
        for dur in (60, 75, 90, 105, 120):
            t = max(g[0, 0], fr[0]) + 5
            while t + dur < min(g[-1, 0], fr[1]) - 5:
                m = window_metrics(g, t, dur)
                if m and m["turns"] >= 1 and m["stationary"] < 0.35 and m["mean_speed"] > 0.4:
                    m.update(ride=rd.name, start_epoch=round(t, 3), dur=dur)
                    m["score"] = round(score(m), 3)
                    if not best or m["score"] > best["score"]:
                        best = m
                t += 10
        if best:
            cands.append(best)
    cands.sort(key=lambda c: -c["score"])
    CANDIDATES.parent.mkdir(parents=True, exist_ok=True)
    CANDIDATES.write_text(json.dumps(cands, indent=1), encoding="utf-8")
    print(f"{len(cands)} rides with a usable window (of {len(rides)})")
    for c in cands[:top]:
        print(json.dumps(c))


def segments(ride_dir: Path) -> list[tuple[float, Path]]:
    out = []
    for p in sorted((ride_dir / "front").glob("*.ts")):
        m = SEG_RE.search(p.name)
        if m:
            s = m.group(1)
            dt = datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
            out.append((dt.timestamp() + int(s[14:]) / 1000.0, p))
    return out


def ensure_video(part: int, ride: str, start: float, dur: float, ride_t0: float) -> None:
    rel0, rel1 = start - ride_t0 - 20, start - ride_t0 + dur + 20
    subprocess.run(
        [str(Path(__file__).parent / ".venv" / "Scripts" / "python"), "-u", "fetch_rides.py", "video",
         "--part", str(part), "--ride", ride, "--from", str(max(rel0, 0)), "--to", str(rel1)],
        cwd=Path(__file__).parent, check=True,
    )


def first_segment_epoch(part: int, ride: str) -> float:
    """Epoch of the ride's first front segment, from the zip listing."""
    listing = (RAW / f"part{part}" / ride / "_listing.txt").read_text(encoding="utf-8")
    stamps = sorted(re.findall(r"uid_s_1000__uid_e_video_(\d{17})\.ts", listing))
    s = stamps[0]
    dt = datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return dt.timestamp() + int(s[14:]) / 1000.0


def concat_cut(segs: list[tuple[float, Path]], start: float, dur: float, out: Path, extra: list[str]) -> None:
    use = [(e, p) for e, p in segs if e <= start + dur and e + 20 >= start]
    if not use:
        raise SystemExit("no video segments cover the window")
    lst = out.with_suffix(".concat.txt")
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for _, p in use), encoding="utf-8")
    offset = start - use[0][0]
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
           "-ss", f"{offset:.3f}", "-t", f"{dur:.3f}", "-an", *extra, str(out)]
    subprocess.run(cmd, check=True)
    lst.unlink()


def cmd_peds(part: int, top: int) -> None:
    from ultralytics import YOLO

    cands = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    model = YOLO(str(yolo_weights()))
    dev = pick_device()
    tmp = ROOT / "data" / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for c in cands[:top]:
        ride_dir = RAW / f"part{part}" / c["ride"]
        ensure_video(part, c["ride"], c["start_epoch"], c["dur"], first_segment_epoch(part, c["ride"]))
        lowres = tmp / f"{c['ride']}_low.mp4"
        concat_cut(segments(ride_dir), c["start_epoch"], c["dur"], lowres,
                   ["-vf", "fps=0.5,scale=640:-2", "-c:v", "libx264", "-preset", "veryfast"])
        frames = read_frames(lowres)
        persons, vehicles = [], []
        for f in frames:
            r = model.predict(f, imgsz=640, classes=[0, 1, 2, 3, 5, 7], conf=0.35, device=dev, verbose=False)[0]
            cls = r.boxes.cls.cpu().numpy().astype(int) if r.boxes is not None else np.array([])
            persons.append(int(np.sum(cls == 0)))
            vehicles.append(int(np.sum(cls != 0)))
        c["persons_per_frame"] = round(float(np.mean(persons)) if persons else 0.0, 2)
        c["vehicles_per_frame"] = round(float(np.mean(vehicles)) if vehicles else 0.0, 2)
        # pedestrians weigh most; vehicles make collision/crossing criteria more interesting
        c["ped_score"] = round(min(c["persons_per_frame"], 3.0) * 0.8 + min(c["vehicles_per_frame"], 3.0) * 0.4, 3)
        c["score"] = round(score(c), 3)
        print(c["ride"], "persons/frame", c["persons_per_frame"], "vehicles/frame", c["vehicles_per_frame"],
              "score", c["score"], flush=True)
    head = sorted(cands[:top], key=lambda c: -c["score"])
    CANDIDATES.write_text(json.dumps(head + cands[top:], indent=1), encoding="utf-8")


def read_frames(path: Path) -> list[np.ndarray]:
    probe = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True, text=True, errors="replace").stderr
    w, h = map(int, re.search(r", (\d{2,5})x(\d{2,5})", probe).groups())
    raw = subprocess.run([FFMPEG, "-loglevel", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // (w * h * 3)
    return [np.frombuffer(raw, np.uint8, w * h * 3, i * w * h * 3).reshape(h, w, 3) for i in range(n)]


def cmd_cut(part: int, rank: int, ride: str | None, start: float | None, dur: float | None, clip_id: str | None) -> None:
    if ride is None:
        c = json.loads(CANDIDATES.read_text(encoding="utf-8"))[rank]
        ride, start, dur = c["ride"], c["start_epoch"], c["dur"]
    assert start is not None and dur is not None
    ride_dir = RAW / f"part{part}" / ride
    ensure_video(part, ride, start, dur, first_segment_epoch(part, ride))
    clip_id = clip_id or f"{ride.split('_')[1]}_{int(start)}"
    out_dir = ROOT / "public" / "data" / clip_id
    out_dir.mkdir(parents=True, exist_ok=True)
    front = out_dir / "front.mp4"
    # constant 20 fps, short GOP so seeking in the dashboard is snappy
    concat_cut(segments(ride_dir), start, dur, front,
               ["-vf", "fps=20,scale=1024:576", "-c:v", "libx264", "-preset", "medium", "-crf", "21",
                "-g", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart"])
    g = load_gps(ride_dir)
    m = (g[:, 0] >= start - 2) & (g[:, 0] <= start + dur + 2)
    pts = [{"t": round(float(r[0] - start), 2), "lat": float(r[1]), "lon": float(r[2])} for r in g[m]]
    meta = {"clipId": clip_id, "ride": ride, "part": part, "startEpoch": start, "duration": dur, "gps": pts,
            "metrics": window_metrics(g, start, dur)}
    (ROOT / "data" / clip_id).mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / clip_id / "gps.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"wrote {front} and data/{clip_id}/gps.json ({len(pts)} GPS points)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["rank", "peds", "cut"])
    ap.add_argument("--part", type=int, default=10)
    ap.add_argument("--top", type=int, default=15)
    ap.add_argument("--rank", type=int, default=0)
    ap.add_argument("--ride")
    ap.add_argument("--start", type=float)
    ap.add_argument("--dur", type=float)
    ap.add_argument("--clip-id")
    a = ap.parse_args()
    if a.cmd == "rank":
        cmd_rank(a.part, a.top)
    elif a.cmd == "peds":
        cmd_peds(a.part, a.top)
    else:
        cmd_cut(a.part, a.rank, a.ride, a.start, a.dur, a.clip_id)


if __name__ == "__main__":
    main()
