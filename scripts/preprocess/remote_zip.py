"""Read individual members of a huge remote zip via HTTP range requests.

FrodoBots-2K ships each part as a single 12-95 GB zip on S3. S3 supports `Range`,
so we read the central directory and then only the members we need, never the whole archive.
"""

from __future__ import annotations

import io
import urllib.request
import zipfile

PART_URL = "https://frodobots-2k-dataset.s3.ap-southeast-1.amazonaws.com/output_rides_{part}.zip"


class HttpRangeFile(io.RawIOBase):
    def __init__(self, url: str):
        self.url = url
        self.pos = 0
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
        self.bytes_fetched = 0

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                break
            except Exception:
                if attempt == 3:
                    raise
        self.pos += len(data)
        self.bytes_fetched += len(data)
        return data

    def readinto(self, b) -> int:  # type: ignore[override]
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def open_part(part: int) -> tuple[zipfile.ZipFile, HttpRangeFile]:
    raw = HttpRangeFile(PART_URL.format(part=part))
    return zipfile.ZipFile(io.BufferedReader(raw, buffer_size=1 << 20)), raw
