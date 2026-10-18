import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  Difficulty,
  Structures,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zInt,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Game, Player, Unit } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ConstructionExecution } from "../ConstructionExecution";
import { ParadropExecution } from "../ParadropExecution";
import { randTerritoryTileArray } from "./NationUtils";

/** Bombers sent within this many ticks make the next one feel dearer. */
const RECENT_BOMBER_WINDOW = 1_500;
/** Each recent bomber adds this share of a bomber's cost to the reserve. */
const RECENT_BOMBER_RESERVE = 0.5;
/** Random enemy territory tiles sampled per enemy, besides its structures. */
const RANDOM_TARGETS_PER_ENEMY = 4;
/** Score weights: structures within bomberStructureRadius, tiles within bomberRadius. */
const STRUCTURE_WEIGHT = 3;
const TILES_PER_POINT = 50;
/** The tile scan around a candidate samples every other tile (×4 weight). */
const TILE_SCAN_STEP = 2;
/** Fighters are kept while an enemy aircraft was seen this recently. */
const ENEMY_AIRCRAFT_MEMORY = 3_000;
/** Impossible nations paradrop at most once per this many ticks... */
const PARADROP_COOLDOWN = 600;
/** ...and only with this many troops in stock. */
const PARADROP_MIN_TROOPS = 50_000;
const PARADROP_TROOP_SHARE = 0.2;

const AIRCRAFT: readonly UnitType[] = [
  UnitType.Bomber,
  UnitType.Fighter,
  UnitType.AirTransport,
];

/**
 * GalloFront: nations use aviation. Hard and Impossible only, once they
 * have the Aviation technology (mil_3). Airports themselves come from
 * NationStructureBehavior's ratios; this behavior, every attack tick:
 *  - with Air Superiority (mil_4), stations one fighter per airport level
 *    while an enemy aircraft was seen in the last 3 000 ticks;
 *  - bombs the enemy tile (neighbors' structures plus a few random tiles of
 *    their land, in range of a ready airport) with the most structures and
 *    land around it, when gold covers the bomber plus a reserve that grows
 *    with the bombers sent recently;
 *  - on Impossible, when no land neighbor can be attacked but an enemy is in
 *    air range, paradrops 20 % of its troops there.
 */
export class NationAirBehavior {
  /** Attack ticks seen. */
  private calls = 0;
  /** Bombers sent so far (for snapshots / debugging). */
  private bombersSent = 0;
  /** Ticks of the bombers sent recently. */
  private bomberTicks: number[] = [];
  /** Last tick an enemy aircraft threatened us (-1: never). */
  private lastEnemyAircraftTick = -1;
  /** Last tick a paradrop was sent (-1: never). */
  private lastParadropTick = -1;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationAirBehaviorSnapshot, {
      calls: this.calls,
      bombersSent: this.bombersSent,
      bomberTicks: [...this.bomberTicks],
      lastEnemyAircraftTick: this.lastEnemyAircraftTick,
      lastParadropTick: this.lastParadropTick,
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    const s = readVersioned(NationAirBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.calls = s.calls;
    this.bombersSent = s.bombersSent;
    this.bomberTicks = [...s.bomberTicks];
    this.lastEnemyAircraftTick = s.lastEnemyAircraftTick;
    this.lastParadropTick = s.lastParadropTick;
  }

  /** Whether this nation flies at all (difficulty and technology). */
  private enabled(): boolean {
    if (!this.isHardOrImpossible()) return false;
    if (this.game.config().isUnitDisabled(UnitType.Airport)) return false;
    return this.player.hasTech(TechId.Mil3);
  }

  private isHardOrImpossible(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    return (
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible
    );
  }

  /** Called every attack tick. True if an aircraft was sent. */
  maybeAct(): boolean {
    if (!this.enabled()) return false;
    this.calls++;
    const ticks = this.game.ticks();
    this.bomberTicks = this.bomberTicks.filter(
      (t) => ticks - t <= RECENT_BOMBER_WINDOW,
    );
    if (this.finishedAirports().length === 0) return false;

    if (this.enemyAircraftNearby()) this.lastEnemyAircraftTick = ticks;

    let acted = this.maybeStationFighter();
    if (this.maybeBomb()) acted = true;
    if (
      !acted &&
      this.game.config().gameConfig().difficulty === Difficulty.Impossible &&
      this.maybeParadrop()
    ) {
      acted = true;
    }
    return acted;
  }

  // ---- shared helpers ----

  private finishedAirports(): Unit[] {
    return this.player
      .units(UnitType.Airport)
      .filter((a) => a.isActive() && !a.isUnderConstruction());
  }

  /** Non-allied living neighbors (sharing a border). */
  private enemyNeighbors(): Player[] {
    const out: Player[] = [];
    for (const n of this.player.nearby()) {
      if (!n.isPlayer()) continue;
      const other = n as Player;
      if (!other.isAlive() || this.player.isFriendly(other)) continue;
      out.push(other);
    }
    return out;
  }

  /** Every living player we may strike (neighbors first, then the rest). */
  private enemies(): Player[] {
    const neighbors = this.enemyNeighbors();
    const seen = new Set(neighbors.map((p) => p.id()));
    const others = this.game
      .players()
      .filter(
        (p) =>
          p !== this.player &&
          p.isAlive() &&
          !seen.has(p.id()) &&
          !this.player.isFriendly(p),
      );
    return [...neighbors, ...others];
  }

  /** Finished structures of `enemy` and a few random tiles of its land. */
  private candidateTiles(enemy: Player): TileRef[] {
    const tiles: TileRef[] = [];
    for (const s of enemy.units(Structures.types)) {
      if (!s.isUnderConstruction()) tiles.push(s.tile());
    }
    tiles.push(
      ...randTerritoryTileArray(
        this.random,
        this.game,
        enemy,
        RANDOM_TARGETS_PER_ENEMY,
      ),
    );
    return tiles;
  }

  /** Enemy tiles within the bomb radius of `tile` (sampled every other tile). */
  private enemyTilesAround(tile: TileRef, enemy: Player): number {
    const r = this.game.config().bomberRadius();
    const cx = this.game.x(tile);
    const cy = this.game.y(tile);
    let count = 0;
    for (let dy = -r; dy <= r; dy += TILE_SCAN_STEP) {
      for (let dx = -r; dx <= r; dx += TILE_SCAN_STEP) {
        if (dx * dx + dy * dy > r * r) continue;
        const cell = new Cell(cx + dx, cy + dy);
        if (!this.game.isOnMap(cell)) continue;
        if (this.game.owner(this.game.ref(cell.x, cell.y)) === enemy) count++;
      }
    }
    return count * TILE_SCAN_STEP * TILE_SCAN_STEP;
  }

  /** The raid's worth: enemy structures near the impact and land under it. */
  targetScore(tile: TileRef, enemy: Player): number {
    const structures = this.game.nearbyUnits(
      tile,
      this.game.config().bomberStructureRadius(),
      Structures.types,
      ({ unit }) => unit.owner() === enemy,
    ).length;
    return (
      STRUCTURE_WEIGHT * structures +
      this.enemyTilesAround(tile, enemy) / TILES_PER_POINT
    );
  }

  // ---- bombers ----

  private bomberCost(): bigint {
    return this.game
      .config()
      .unitInfo(UnitType.Bomber)
      .cost(this.game, this.player);
  }

  /** Gold a bomber must leave behind: half a bomber per recent sortie. */
  private bomberReserve(cost: bigint): bigint {
    const recent = this.bomberTicks.length;
    return (
      cost +
      (cost * BigInt(Math.round(recent * RECENT_BOMBER_RESERVE * 100))) / 100n
    );
  }

  /** The best tile to bomb among the neighbors' land in range, or null. */
  bombTarget(): TileRef | null {
    let best: TileRef | null = null;
    let bestScore = 0;
    for (const enemy of this.enemyNeighbors()) {
      for (const tile of this.candidateTiles(enemy)) {
        if (this.player.canBuild(UnitType.Bomber, tile) === false) continue;
        const score = this.targetScore(tile, enemy);
        if (best === null || score > bestScore) {
          best = tile;
          bestScore = score;
        }
      }
    }
    return best;
  }

  private maybeBomb(): boolean {
    const cost = this.bomberCost();
    if (this.player.gold() < this.bomberReserve(cost)) return false;
    const tile = this.bombTarget();
    if (tile === null) return false;
    this.game.addExecution(
      new ConstructionExecution(this.player, UnitType.Bomber, tile),
    );
    this.bombersSent++;
    this.bomberTicks.push(this.game.ticks());
    return true;
  }

  // ---- paradrops ----

  /** An enemy tile reachable by air when no neighbor can be walked into. */
  paradropTarget(): TileRef | null {
    if (this.enemyNeighbors().length > 0) return null;
    let best: TileRef | null = null;
    let bestScore = 0;
    for (const enemy of this.enemies()) {
      for (const tile of this.candidateTiles(enemy)) {
        if (!this.game.isLand(tile)) continue;
        if (this.player.canBuild(UnitType.AirTransport, tile) === false) {
          continue;
        }
        // Land where the enemy is thin: fewer defenders on arrival.
        const score = 1_000 - this.targetScore(tile, enemy);
        if (best === null || score > bestScore) {
          best = tile;
          bestScore = score;
        }
      }
    }
    return best;
  }

  private maybeParadrop(): boolean {
    const ticks = this.game.ticks();
    if (
      this.lastParadropTick >= 0 &&
      ticks - this.lastParadropTick < PARADROP_COOLDOWN
    ) {
      return false;
    }
    if (this.player.troops() < PARADROP_MIN_TROOPS) return false;
    const cost = this.game
      .config()
      .unitInfo(UnitType.AirTransport)
      .cost(this.game, this.player);
    if (this.player.gold() < cost) return false;
    const tile = this.paradropTarget();
    if (tile === null) return false;
    this.game.addExecution(
      new ParadropExecution(
        this.player,
        tile,
        Math.floor(this.player.troops() * PARADROP_TROOP_SHARE),
      ),
    );
    this.lastParadropTick = ticks;
    return true;
  }

  // ---- fighters ----

  /** An enemy aircraft in range of one of our airports, or aimed at our land. */
  private enemyAircraftNearby(): boolean {
    const cfg = this.game.config();
    const airports = this.finishedAirports();
    for (const u of this.game.units(AIRCRAFT)) {
      const owner = u.owner();
      if (owner === this.player || this.player.isFriendly(owner)) continue;
      const target = u.targetTile();
      if (target !== undefined && this.game.owner(target) === this.player) {
        return true;
      }
      for (const a of airports) {
        if (
          this.game.manhattanDist(a.tile(), u.tile()) <=
          cfg.airportRange(a.level())
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private maybeStationFighter(): boolean {
    if (!this.player.hasTech(TechId.Mil4)) return false;
    if (this.game.config().isUnitDisabled(UnitType.Fighter)) return false;
    if (
      this.lastEnemyAircraftTick < 0 ||
      this.game.ticks() - this.lastEnemyAircraftTick > ENEMY_AIRCRAFT_MEMORY
    ) {
      return false;
    }
    const cost = this.game
      .config()
      .unitInfo(UnitType.Fighter)
      .cost(this.game, this.player);
    if (this.player.gold() < cost) return false;
    for (const airport of this.finishedAirports()) {
      if (this.player.canBuild(UnitType.Fighter, airport.tile()) === false) {
        continue;
      }
      this.game.addExecution(
        new ConstructionExecution(
          this.player,
          UnitType.Fighter,
          airport.tile(),
        ),
      );
      return true;
    }
    return false;
  }
}

export const NationAirBehaviorSnapshot = snapshotType({
  name: "NationAirBehavior",
  version: 1,
  schema: z.object({
    calls: zInt(),
    bombersSent: zInt(),
    bomberTicks: z.array(zInt()),
    lastEnemyAircraftTick: zInt(),
    lastParadropTick: zInt(),
  }),
});
