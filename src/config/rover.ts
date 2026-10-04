// Rover profile. Values live in rover.json so the Python preprocessing reads the same numbers.
// They are assumptions fitted to the FrodoBots EarthRover clip; replace with the real rover's values.
import profile from "./rover.json";

export interface RoverProfile {
  name: string;
  cameraHeightM: number;
  /** negative = looking down */
  cameraPitchDeg: number;
  hfovDeg: number;
  maxSpeedMps: number;
  wheelBaseM: number;
  /** body width, used for the planned-path ribbon */
  widthM: number;
}

export const ROVER: RoverProfile = {
  name: profile.name,
  cameraHeightM: profile.cameraHeightM,
  cameraPitchDeg: profile.cameraPitchDeg,
  hfovDeg: profile.hfovDeg,
  maxSpeedMps: profile.maxSpeedMps,
  wheelBaseM: profile.wheelBaseM,
  widthM: profile.widthM,
};

/** target_speed levels as fractions of maxSpeedMps (1.2 m/s -> 0 / 0.3 / 0.7 / 1.2) */
export const SPEED_LEVELS = { stop: 0, crawl: 0.25, slow: 0.6, normal: 1 } as const;
export type SpeedLevel = keyof typeof SPEED_LEVELS;

export const speedFor = (level: SpeedLevel, rover: RoverProfile = ROVER) =>
  Math.round(rover.maxSpeedMps * SPEED_LEVELS[level] * 10) / 10;
