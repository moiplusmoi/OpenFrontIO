import {
  DefenseBlocks,
  DEFENSE_BLOCK_SIZE,
} from "../../../src/client/view/DefenseBlocks";

describe("client defence blocks", () => {
  test("a block's clock restarts when one of its tiles changes", () => {
    const blocks = new DefenseBlocks(100, 100);
    blocks.markChanged(3, 3, 50);
    expect(blocks.heldTicks(0, 0, 80)).toBe(30);
    // Another tile of the same block resets it.
    blocks.markChanged(10, 10, 70);
    expect(blocks.heldTicks(3, 3, 80)).toBe(10);
  });

  test("blocks are independent of each other", () => {
    const blocks = new DefenseBlocks(100, 100);
    blocks.markChanged(3, 3, 50);
    expect(blocks.heldTicks(DEFENSE_BLOCK_SIZE, 0, 80)).toBe(80);
  });
});
