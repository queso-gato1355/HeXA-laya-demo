"""Fetch FrodoBots-2K metadata (GPS/control/timestamps CSVs) for every ride in one part,
or the front-camera video segments of a single ride, without downloading the whole part zip.

  python fetch_rides.py meta  --part 10            # CSVs only, a few MB total
  python fetch_rides.py video --part 10 --ride ride_27837_20240405085859 [--from 120 --to 260]
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

from remote_zip import open_part

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
META_PATTERNS = ("gps_data_", "control_data_", "front_camera_timestamps_")
# front camera stream is uid_s_1000 (video), see docs/dataset-notes.md
FRONT_VIDEO_RE = re.compile(r"uid_s_1000__uid_e_video(?:_(\d{17}))?\.(ts|m3u8)$")


def group_by_ride(zf):
    rides = defaultdict(list)
    for info in zf.infolist():
        parts = info.filename.split("/")
        if len(parts) >= 3 and parts[1].startswith("ride_") and not info.is_dir():
            rides[parts[1]].append(info)
    return rides


def cmd_meta(part: int) -> None:
    zf, raw = open_part(part)
    rides = group_by_ride(zf)
    print(f"part {part}: {len(rides)} rides", flush=True)
    for i, (ride, infos) in enumerate(sorted(rides.items())):
        out = RAW / f"part{part}" / ride
        out.mkdir(parents=True, exist_ok=True)
        names = []
        for info in infos:
            base = info.filename.rsplit("/", 1)[-1]
            names.append(info.filename.split(ride + "/", 1)[1])
            if base.startswith(META_PATTERNS):
                dest = out / base
                if not dest.exists() or dest.stat().st_size != info.file_size:
                    dest.write_bytes(zf.read(info))
        (out / "_listing.txt").write_text(
            "\n".join(f"{n}\t{i.file_size}" for n, i in zip(names, infos)), encoding="utf-8"
        )
        print(f"  [{i + 1}/{len(rides)}] {ride}  fetched={raw.bytes_fetched / 1e6:.1f}MB", flush=True)


def cmd_video(part: int, ride: str, t_from: float | None, t_to: float | None) -> None:
    """Download front-camera .ts segments overlapping [t_from, t_to] seconds from ride start."""
    zf, raw = open_part(part)
    infos = group_by_ride(zf)[ride]
    out = RAW / f"part{part}" / ride / "front"
    out.mkdir(parents=True, exist_ok=True)
    segs = []
    for info in infos:
        m = FRONT_VIDEO_RE.search(info.filename)
        if not m:
            continue
        if m.group(2) == "m3u8":
            (out / "playlist.m3u8").write_bytes(zf.read(info))
            continue
        segs.append((m.group(1), info))
    segs.sort(key=lambda s: s[0])
    from datetime import datetime

    def ts(stamp: str) -> float:
        return datetime.strptime(stamp, "%Y%m%d%H%M%S%f").timestamp() if len(stamp) == 17 else 0.0

    # segment stamp is yyyymmddHHMMSSmmm; %f eats the 3 ms digits as fractional seconds
    t0 = ts(segs[0][0])
    chosen = []
    for idx, (stamp, info) in enumerate(segs):
        start = ts(stamp) - t0
        end = ts(segs[idx + 1][0]) - t0 if idx + 1 < len(segs) else start + 30
        if t_from is not None and end < t_from:
            continue
        if t_to is not None and start > t_to:
            continue
        chosen.append((stamp, info, start))
    total = sum(i.file_size for _, i, _ in chosen)
    print(f"{len(chosen)}/{len(segs)} segments, {total / 1e6:.1f}MB", flush=True)
    for k, (stamp, info, start) in enumerate(chosen):
        dest = out / f"{stamp}.ts"
        if not dest.exists() or dest.stat().st_size != info.file_size:
            dest.write_bytes(zf.read(info))
        print(f"  [{k + 1}/{len(chosen)}] {stamp} (+{start:.1f}s)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["meta", "video"])
    ap.add_argument("--part", type=int, default=10)
    ap.add_argument("--ride")
    ap.add_argument("--from", dest="t_from", type=float)
    ap.add_argument("--to", dest="t_to", type=float)
    a = ap.parse_args()
    if a.cmd == "meta":
        cmd_meta(a.part)
    else:
        if not a.ride:
            sys.exit("--ride is required")
        cmd_video(a.part, a.ride, a.t_from, a.t_to)


if __name__ == "__main__":
    main()
