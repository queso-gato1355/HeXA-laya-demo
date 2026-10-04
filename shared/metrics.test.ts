import { describe, expect, it } from "vitest";
import { parseNvidiaSmiLine } from "./metrics";

describe("parseNvidiaSmiLine", () => {
  it("parses a csv,noheader,nounits line", () => {
    expect(parseNvidiaSmiLine("NVIDIA GeForce RTX 3090, 41, 6139, 24576, 63, 187.55")).toEqual({
      name: "NVIDIA GeForce RTX 3090",
      utilPct: 41,
      memUsedMB: 6139,
      memTotalMB: 24576,
      tempC: 63,
      powerW: 187.55,
    });
  });
  it("keeps optional fields null when not supported", () => {
    expect(parseNvidiaSmiLine("Some GPU, 5, 100, 4096, [N/A], [N/A]")?.powerW).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseNvidiaSmiLine("")).toBeNull();
    expect(parseNvidiaSmiLine("a, b, c, d, e, f")).toBeNull();
  });
});
