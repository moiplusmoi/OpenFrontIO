import { TileRef } from "@openfront/engine-api/game/GameMap";
import { ResourceType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { getOrientedRailroad } from "../game/Railroad";
import { PathFinding, WaterPathFinder } from "../pathfinding/PathFinder";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Tiles (rail) or steps (sea, air) a convoy covers per tick. */
export const CONVOY_SPEED = { rail: 2, sea: 2, air: 4 } as const;

export type ConvoyMode = keyof typeof CONVOY_SPEED;

/**
 * A convoy carries one resource from a structure's stock to another structure
 * of the same owner: by rail between stations, by sea between ports, or by air
 * between airports. It takes its cargo when it leaves; what does not fit at the
 * destination goes back to the source. A convoy whose route breaks (a structure
 * lost, or a rail link cut) brings its cargo home.
 */
export class ResourceConvoyExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  private loaded = 0;
  private position: TileRef = 0;
  private railTiles: TileRef[] = [];
  private railIndex = 0;
  private pathFinder: WaterPathFinder | null = null;

  constructor(
    private owner: Player,
    private src: Unit,
    private dst: Unit,
    private resource: ResourceType,
    private amount: number,
    private mode: ConvoyMode,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.game = mg;
    if (!this.routeIsValid(mg)) {
      this.active = false;
      return;
    }
    this.loaded = this.src.takeStock(this.resource, this.amount);
    if (this.loaded === 0) {
      this.active = false;
      return;
    }
    this.position = this.src.tile();
    if (this.mode === "rail") {
      this.railTiles = this.buildRailTiles(mg);
      if (this.railTiles.length === 0) {
        this.abort();
        return;
      }
      this.position = this.railTiles[0];
    } else if (this.mode === "sea") {
      this.pathFinder = new WaterPathFinder(
        mg,
        mg.nextShipStagger("tradeShip"),
        true,
      );
    }
  }

  tick(_ticks: number): void {
    if (!this.active || this.game === null) return;
    if (!this.routeStillOwned()) {
      this.abort();
      return;
    }
    if (this.mode === "rail") {
      this.moveAlongRail();
    } else {
      this.moveWithPathFinder();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Where the convoy is now, for display and tests. */
  tile(): TileRef {
    return this.position;
  }

  cargo(): number {
    return this.loaded;
  }

  private routeIsValid(mg: Game): boolean {
    if (!this.src.isActive() || !this.dst.isActive()) return false;
    if (this.src.owner() !== this.owner || !this.canReach(this.dst.owner())) {
      return false;
    }
    if (this.src === this.dst || this.amount <= 0) return false;
    const srcType = this.src.type();
    const dstType = this.dst.type();
    if (this.mode === "rail") {
      return (
        mg.railNetwork().stationManager().findStation(this.src) !== null &&
        mg.railNetwork().stationManager().findStation(this.dst) !== null
      );
    }
    if (this.mode === "sea") {
      if (srcType !== UnitType.Port || dstType !== UnitType.Port) return false;
      const component = mg.getWaterComponent(this.src.tile());
      return (
        component !== null && mg.hasWaterComponent(this.dst.tile(), component)
      );
    }
    return srcType === UnitType.Airport && dstType === UnitType.Airport;
  }

  /** Own structures always; another player's only when the trade is allowed. */
  private canReach(recipient: Player): boolean {
    return recipient === this.owner || this.owner.canTrade(recipient);
  }

  private routeStillOwned(): boolean {
    return (
      this.src.isActive() &&
      this.dst.isActive() &&
      this.src.owner() === this.owner &&
      this.canReach(this.dst.owner())
    );
  }

  private buildRailTiles(mg: Game): TileRef[] {
    const stations = mg.railNetwork().stationManager();
    const from = stations.findStation(this.src);
    const to = stations.findStation(this.dst);
    if (from === null || to === null) return [];
    const path = mg.railNetwork().findStationsPath(from, to);
    if (path.length < 2) return [];
    const tiles: TileRef[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const segment = getOrientedRailroad(path[i], path[i + 1]);
      if (segment === null) return [];
      tiles.push(...segment.getTiles());
    }
    return tiles;
  }

  private moveAlongRail(): void {
    this.railIndex = Math.min(
      this.railTiles.length - 1,
      this.railIndex + CONVOY_SPEED.rail,
    );
    this.position = this.railTiles[this.railIndex];
    if (this.railIndex === this.railTiles.length - 1) this.deliver();
  }

  private moveWithPathFinder(): void {
    if (this.game === null) return;
    // The air pathfinder is stateless, so it is made on demand and never stored.
    const pathFinder =
      this.mode === "air" ? PathFinding.Air(this.game) : this.pathFinder;
    if (pathFinder === null) return;
    for (let i = 0; i < CONVOY_SPEED[this.mode]; i++) {
      const result = pathFinder.next(this.position, this.dst.tile());
      if (result.status === PathStatus.COMPLETE) {
        this.deliver();
        return;
      }
      if (result.status !== PathStatus.NEXT) {
        this.abort();
        return;
      }
      this.position = result.node;
    }
  }

  /**
   * Hands the cargo over. Another player's structure is a sale: the buyer pays
   * the price per unit, and only what it can pay is delivered.
   */
  private deliver(): void {
    const buyer = this.dst.owner();
    let deliverable = this.loaded;
    const price = this.game!.config().resourcePrice(this.resource);
    if (buyer !== this.owner) {
      const affordable = price > 0n ? buyer.gold() / price : 0n;
      deliverable = Math.min(this.loaded, Number(affordable));
    }
    const stored = this.dst.addStock(this.resource, deliverable);
    if (buyer !== this.owner && stored > 0) {
      const paid = BigInt(stored) * price;
      buyer.removeGold(paid);
      this.owner.addGold(paid);
    }
    const back = this.loaded - stored;
    if (back > 0) this.src.addStock(this.resource, back);
    this.loaded = 0;
    this.active = false;
  }

  private abort(): void {
    if (this.loaded > 0 && this.src.isActive()) {
      this.src.addStock(this.resource, this.loaded);
    }
    this.loaded = 0;
    this.active = false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ResourceConvoySnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      owner: w.player(this.owner),
      src: w.unit(this.src),
      dst: w.unit(this.dst),
      resource: this.resource,
      amount: this.amount,
      mode: this.mode,
      loaded: this.loaded,
      position: this.position,
      railTiles: [...this.railTiles],
      railIndex: this.railIndex,
      pathFinder:
        this.pathFinder === null ? null : waterPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: ConvoyState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
    this.owner = r.player(s.owner);
    this.src = r.unit(s.src);
    this.dst = r.unit(s.dst);
    this.resource = s.resource;
    this.amount = s.amount;
    this.mode = s.mode;
    this.loaded = s.loaded;
    this.position = s.position;
    this.railTiles = [...s.railTiles];
    this.railIndex = s.railIndex;
    this.pathFinder =
      s.pathFinder === null
        ? null
        : restoreWaterPathFinder(r.game, s.pathFinder);
  }
}

const ConvoyStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  owner: zRef(),
  src: zRef(),
  dst: zRef(),
  resource: z.enum(ResourceType),
  amount: zInt(),
  mode: z.enum(["rail", "sea", "air"]),
  loaded: zInt(),
  position: zInt(),
  railTiles: z.array(zInt()),
  railIndex: zInt(),
  pathFinder: WaterPathFinderSchema.nullable(),
});

type ConvoyState = z.infer<typeof ConvoyStateSchema>;

export const ResourceConvoySnapshot = execSnapshotType({
  name: "ResourceConvoy",
  version: 1,
  schema: ConvoyStateSchema,
  cls: () => ResourceConvoyExecution,
});

/**
 * The player's order: resolves the two structures by ID on its first tick and
 * starts the convoy. An order that names a structure the player no longer owns
 * does nothing.
 */
export class SendConvoyExecution implements Execution {
  private active = true;
  private game: Game | null = null;

  constructor(
    private owner: Player,
    private srcId: number,
    private dstId: number,
    private resource: ResourceType,
    private amount: number,
    private mode: ConvoyMode,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.game = mg;
  }

  tick(_ticks: number): void {
    if (this.game === null) return;
    this.active = false;
    const src = this.game.unit(this.srcId);
    const dst = this.game.unit(this.dstId);
    if (src === undefined || dst === undefined) return;
    this.game.addExecution(
      new ResourceConvoyExecution(
        this.owner,
        src,
        dst,
        this.resource,
        this.amount,
        this.mode,
      ),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SendConvoySnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      owner: w.player(this.owner),
      srcId: this.srcId,
      dstId: this.dstId,
      resource: this.resource,
      amount: this.amount,
      mode: this.mode,
    });
  }

  restoreSnapshot(s: SendConvoyState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
    this.owner = r.player(s.owner);
    this.srcId = s.srcId;
    this.dstId = s.dstId;
    this.resource = s.resource;
    this.amount = s.amount;
    this.mode = s.mode;
  }
}

const SendConvoyStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  owner: zRef(),
  srcId: zInt(),
  dstId: zInt(),
  resource: z.enum(ResourceType),
  amount: zInt(),
  mode: z.enum(["rail", "sea", "air"]),
});

type SendConvoyState = z.infer<typeof SendConvoyStateSchema>;

export const SendConvoySnapshot = execSnapshotType({
  name: "SendConvoy",
  version: 1,
  schema: SendConvoyStateSchema,
  cls: () => SendConvoyExecution,
});
