import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  ResourceType,
  RESOURCE_TYPES,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

/** One deposit per this many land tiles, never fewer than MIN_DEPOSITS. */
const LAND_PER_DEPOSIT = 350;
const MIN_DEPOSITS = 6;
const SEED_SALT = 0x6e6f6465;

/**
 * Places the resource deposits of a map for one game. Pure and deterministic:
 * the seed is the game ID, so every client, every snapshot restore and every
 * replay of the same game gets the same deposits, and another game on the same
 * map gets different ones. Deposits are never on water or next to each other.
 */
export function generateResourceDeposits(
  map: GameMap,
  gameID: string,
): Map<TileRef, ResourceType> {
  const deposits = new Map<TileRef, ResourceType>();
  const land: TileRef[] = [];
  map.forEachTile((tile) => {
    if (map.isLand(tile) && !map.isImpassable(tile)) land.push(tile);
  });
  if (land.length === 0) return deposits;

  const random = new PseudoRandom(
    (simpleHash(gameID) ^ SEED_SALT) +
      map.width() * 7919 +
      map.height() * 104729,
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
