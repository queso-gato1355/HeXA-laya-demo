import { describe, expect, it } from "vitest";
import { fromEN } from "./geo";
import { cameraToImage, focalPx, groundToCamera, nearestVisibleGroundM, projectPolyline, worldToRobot } from "./projection";
import { ORIGIN } from "./testing";

const cam = { heightM: 0.5, pitchDeg: -10, hfovDeg: 90, width: 1000, height: 600 };

describe("projection", () => {
  it("a point straight ahead lands on the vertical centre line, below the horizon", () => {
    const p = cameraToImage(groundToCamera(5, 0, cam), cam);
    expect(p.u).toBeCloseTo(500, 6);
    // camera looks 10 deg down -> horizon is above the image centre; 5 m ahead is 5.7 deg below it
    const horizonV = 300 - focalPx(cam) * Math.tan((10 * Math.PI) / 180);
    const expectedV = 300 + focalPx(cam) * Math.tan(((Math.atan(0.5 / 5) * 180) / Math.PI - 10) * (Math.PI / 180));
    expect(p.v).toBeGreaterThan(horizonV);
    expect(p.v).toBeCloseTo(expectedV, 6);
  });

  it("farther ground points move up toward the horizon", () => {
    const near = cameraToImage(groundToCamera(2, 0, cam), cam);
    const far = cameraToImage(groundToCamera(20, 0, cam), cam);
    expect(far.v).toBeLessThan(near.v);
  });

  it("points to the right project right of centre", () => {
    expect(cameraToImage(groundToCamera(5, 1, cam), cam).u).toBeGreaterThan(500);
  });

  it("nearest visible ground projects onto the bottom row", () => {
    const d = nearestVisibleGroundM(cam);
    expect(cameraToImage(groundToCamera(d, 0, cam), cam).v).toBeCloseTo(cam.height, 3);
    const up = { ...cam, heightM: 0.82, pitchDeg: 5.3, hfovDeg: 105 };
    expect(nearestVisibleGroundM(up)).toBeGreaterThan(1.2);
  });

  it("worldToRobot rotates by heading", () => {
    const east = fromEN(ORIGIN, 10, 0);
    const r = worldToRobot(ORIGIN, 90, east); // facing east
    expect(r.forward).toBeCloseTo(10, 3);
    expect(r.right).toBeCloseTo(0, 3);
    expect(worldToRobot(ORIGIN, 0, east).right).toBeCloseTo(10, 3); // facing north: east is to the right
  });

  it("clips the part of a polyline behind the camera", () => {
    const pts = [fromEN(ORIGIN, 0, -5), fromEN(ORIGIN, 0, 5), fromEN(ORIGIN, 0, 10)];
    const runs = projectPolyline(pts, ORIGIN, 0, cam);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3); // clipped start + 2 visible points
    for (const p of runs[0]) expect(Number.isFinite(p.v)).toBe(true);
  });
});
