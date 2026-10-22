import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, test } from "vitest";
import {
  BATCH_PLACE_INTERVAL_MS,
  batchPlaceReady,
  isBatchPlaceable,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";

describe("batch placement", () => {
  test("only warships can be batch-placed", () => {
    expect(isBatchPlaceable(UnitType.Warship)).toBe(true);
    expect(isBatchPlaceable(UnitType.City)).toBe(false);
    expect(isBatchPlaceable(UnitType.AtomBomb)).toBe(false);
  });

  test("warship ghost stays armed only while batch mode is on", () => {
    expect(shouldPreserveGhostAfterBuild(UnitType.Warship, true)).toBe(true);
    expect(shouldPreserveGhostAfterBuild(UnitType.Warship, false)).toBe(false);
    expect(shouldPreserveGhostAfterBuild(UnitType.Warship)).toBe(false);
  });

  test("batch mode does not keep non-naval structures armed", () => {
    expect(shouldPreserveGhostAfterBuild(UnitType.City, true)).toBe(false);
    expect(shouldPreserveGhostAfterBuild(UnitType.Port, true)).toBe(false);
  });

  test("nukes keep the ghost regardless of batch mode", () => {
    expect(shouldPreserveGhostAfterBuild(UnitType.AtomBomb)).toBe(true);
    expect(shouldPreserveGhostAfterBuild(UnitType.HydrogenBomb, false)).toBe(
      true,
    );
  });

  test("placements are spaced by the batch interval", () => {
    const last = 1000;
    expect(batchPlaceReady(last, last + BATCH_PLACE_INTERVAL_MS - 1)).toBe(
      false,
    );
    expect(batchPlaceReady(last, last + BATCH_PLACE_INTERVAL_MS)).toBe(true);
  });

  test("the first placement is never throttled", () => {
    expect(batchPlaceReady(-Infinity, 0)).toBe(true);
  });

  test("the spacing keeps a burst under the server's 10 intents/s limit", () => {
    expect(1000 / BATCH_PLACE_INTERVAL_MS).toBeLessThanOrEqual(10);
  });
});
