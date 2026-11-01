/**
 * GalloFront: the client's copy of the engine's defence blocks. A block's clock
 * restarts whenever one of its tiles changes owner, as the engine does, so the
 * fortification drawn matches the one attacks use. A player who joins mid-game
 * starts every block fresh, so their view can run a little behind.
 */
export const DEFENSE_BLOCK_SIZE = 16;

export class DefenseBlocks {
  private readonly lastChange: Uint32Array;
  private readonly blocksPerRow: number;

  constructor(width: number, height: number) {
    this.blocksPerRow = Math.ceil(width / DEFENSE_BLOCK_SIZE);
    this.lastChange = new Uint32Array(
      this.blocksPerRow * Math.ceil(height / DEFENSE_BLOCK_SIZE),
    );
  }

  private index(x: number, y: number): number {
    return (
      Math.floor(y / DEFENSE_BLOCK_SIZE) * this.blocksPerRow +
      Math.floor(x / DEFENSE_BLOCK_SIZE)
    );
  }

  markChanged(x: number, y: number, tick: number): void {
    this.lastChange[this.index(x, y)] = tick;
  }

  heldTicks(x: number, y: number, tick: number): number {
    return tick - this.lastChange[this.index(x, y)];
  }
}
