import {
  BATCH_RADIUS,
  batchOffsets,
} from "@openfront/engine-lib/game/BatchOffsets";

describe("batch offsets", () => {
  test("cover the square around the click, nearest first", () => {
    const offsets = batchOffsets();
    const side = 2 * BATCH_RADIUS + 1;
    expect(offsets.length).toBe(side * side);
    expect(offsets[0]).toEqual([0, 0]);
    // Nearest first: squared distances never decrease.
    const d2 = (o: readonly [number, number]) => o[0] * o[0] + o[1] * o[1];
    for (let i = 1; i < offsets.length; i++) {
      expect(d2(offsets[i])).toBeGreaterThanOrEqual(d2(offsets[i - 1]));
    }
  });
});
