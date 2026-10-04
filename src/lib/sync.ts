// Video sync: the original front video is the master clock; followers are corrected when they drift
// more than SYNC_TOLERANCE_S. Frame callbacks use requestVideoFrameCallback when available.

export const SYNC_TOLERANCE_S = 0.05;

type FrameCb = (mediaTime: number) => void;

export function onEveryFrame(video: HTMLVideoElement, cb: FrameCb): () => void {
  let stopped = false;
  let handle = 0;
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    cancelVideoFrameCallback?: (h: number) => void;
  };
  if (typeof v.requestVideoFrameCallback === "function") {
    const loop = (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      cb(meta.mediaTime);
      handle = v.requestVideoFrameCallback!(loop);
    };
    handle = v.requestVideoFrameCallback(loop);
    return () => {
      stopped = true;
      v.cancelVideoFrameCallback?.(handle);
    };
  }
  const loop = () => {
    if (stopped) return;
    cb(video.currentTime);
    handle = requestAnimationFrame(loop);
  };
  handle = requestAnimationFrame(loop);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
}

export function syncFollower(master: HTMLVideoElement, follower: HTMLVideoElement): void {
  if (Math.abs(follower.currentTime - master.currentTime) > SYNC_TOLERANCE_S) {
    follower.currentTime = master.currentTime;
  }
  if (follower.playbackRate !== master.playbackRate) follower.playbackRate = master.playbackRate;
  if (master.paused && !follower.paused) follower.pause();
  if (!master.paused && follower.paused) void follower.play().catch(() => undefined);
}

/** Keep a set of follower videos locked to the master. Returns a disposer. */
export function attachSync(master: HTMLVideoElement, followers: () => HTMLVideoElement[]): () => void {
  const all = () => followers().filter((f) => f && f !== master);
  const stopFrame = onEveryFrame(master, () => all().forEach((f) => syncFollower(master, f)));
  const onPlay = () => all().forEach((f) => void f.play().catch(() => undefined));
  const onPause = () =>
    all().forEach((f) => {
      f.pause();
      f.currentTime = master.currentTime;
    });
  const onSeek = () => all().forEach((f) => (f.currentTime = master.currentTime));
  const onRate = () => all().forEach((f) => (f.playbackRate = master.playbackRate));
  master.addEventListener("play", onPlay);
  master.addEventListener("pause", onPause);
  master.addEventListener("seeking", onSeek);
  master.addEventListener("ratechange", onRate);
  return () => {
    stopFrame();
    master.removeEventListener("play", onPlay);
    master.removeEventListener("pause", onPause);
    master.removeEventListener("seeking", onSeek);
    master.removeEventListener("ratechange", onRate);
  };
}
