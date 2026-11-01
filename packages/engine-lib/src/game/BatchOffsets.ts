/**
 * GalloFront batch builds: the tile offsets around a click, nearest first
 * (ties by x, then y). Shared by the executor, which places the lot, and the
 * client, which previews it, so both walk the tiles in the same order.
 */
export const BATCH_RADIUS = 30;

let offsets: [number, number][] | null = null;

export function batchOffsets(): readonly (readonly [number, number])[] {
  if (offsets === null) {
    const list: [number, number][] = [];
    for (let dy = -BATCH_RADIUS; dy <= BATCH_RADIUS; dy++) {
      for (let dx = -BATCH_RADIUS; dx <= BATCH_RADIUS; dx++) {
        list.push([dx, dy]);
      }
    }
    list.sort(
      (a, b) =>
        a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) ||
        a[1] - b[1] ||
        a[0] - b[0],
    );
    offsets = list;
  }
  return offsets;
}
