import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  ResourceType,
  RESOURCE_TYPES,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "../PseudoRandom";

/** One deposit per this many land tiles, never fewer than MIN_DEPOSITS. */
const LAND_PER_DEPOSIT = 350;
const MIN_DEPOSITS = 6;
const SEED_SALT = 0x6e6f6465;

/**
 * Places the resource deposits of a map. Pure and deterministic: the seed comes
 * from the map's own size, so every client (and every snapshot restore) gets
 * the same deposits. Deposits are never on water or next to each other.
 */
export function generateResourceDeposits(
  map: GameMap,
): Map<TileRef, ResourceType> {
  const deposits = new Map<TileRef, ResourceType>();
  const land: TileRef[] = [];
  map.forEachTile((tile) => {
    if (map.isLand(tile) && !map.isImpassable(tile)) land.push(tile);
  });
  if (land.length === 0) return deposits;

  const random = new PseudoRandom(
    map.width() * 7919 + map.height() * 104729 + SEED_SALT,
  );
  const wanted = Math.max(
    MIN_DEPOSITS,
    Math.floor(land.length / LAND_PER_DEPOSIT),
  );
  const maxAttempts = wanted * 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (deposits.size >= wanted) break;
    const tile = land[random.nextInt(0, land.length)];
    if (deposits.has(tile)) continue;
    if (map.neighbors(tile).some((n) => deposits.has(n))) continue;
    deposits.set(
      tile,
      RESOURCE_TYPES[random.nextInt(0, RESOURCE_TYPES.length)],
    );
  }
  return deposits;
}
