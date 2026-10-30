import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  AirPathFinderSchema,
  airPathFinderState,
  restoreAirPathFinder,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * GalloFront: a commercial airliner flies from one airport to another
 * player's airport. Like a trade ship it pays both airports' owners on
 * arrival, scaled by the flight distance. It carries no troops and cannot be
 * shot down. If its destination falls, or trade between the two owners stops,
 * it is removed without payment. Between two airports of the same owner it
 * flies for the traffic only and pays nothing, so it cannot be farmed.
 */
export class CommercialAircraftExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private pathFinder: SteppingPathFinder<TileRef>;
  private dist = 0;

  constructor(
    private src: Unit,
    private dst: Unit,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
    if (!this.src.isActive() || !this.dst.isActive() || !this.canTrade()) {
      this.active = false;
      return;
    }
    this.dist = mg.manhattanDist(this.src.tile(), this.dst.tile());
    this.plane = this.src
      .owner()
      .buildUnit(UnitType.CommercialAircraft, this.src.tile(), {
        targetUnit: this.dst,
      });
  }

  tick(_ticks: number): void {
    if (this.plane === null) return;
    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }
    if (!this.dst.isActive() || !this.canTrade()) {
      this.abort();
      return;
    }

    const speed = this.mg.config().commercialAircraftSpeed();
    for (let i = 0; i < speed; i++) {
      const result = this.pathFinder.next(this.plane.tile(), this.dst.tile());
      if (result.status === PathStatus.COMPLETE) {
        this.complete();
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.plane.move(result.node);
      } else {
        this.abort();
        return;
      }
    }
  }

  private canTrade(): boolean {
    const from = this.src.owner();
    const to = this.dst.owner();
    return from === to || from.canTrade(to);
  }

  private abort(): void {
    this.plane!.delete(false);
    this.active = false;
  }

  private complete(): void {
    this.active = false;
    this.plane!.delete(false);
    if (this.src.owner() === this.dst.owner()) return;
    const gold = this.mg
      .config()
      .commercialAircraftGold(this.dist, this.src.owner(), this.mg.season());
    this.src.owner().addGold(gold, this.src.tile());
    this.dst.owner().addGold(gold, this.dst.tile());
    this.src.owner().addTradeGold(gold);
    this.dst.owner().addTradeGold(gold);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CommercialAircraftExecutionSnapshot.write({
      active: this.active,
      src: w.unit(this.src),
      dst: w.unit(this.dst),
      dist: this.dist,
      plane: this.plane === null ? null : w.unit(this.plane),
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: CommercialAircraftState, r: SnapshotReader): void {
    this.active = s.active;
    this.src = r.unit(s.src);
    this.dst = r.unit(s.dst);
    this.dist = s.dist;
    this.plane = s.plane === null ? null : r.unit(s.plane);
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
  }
}

const CommercialAircraftStateSchema = z.object({
  active: z.boolean(),
  src: zRef(),
  dst: zRef(),
  dist: zInt(),
  plane: zRef().nullable(),
  pathFinder: AirPathFinderSchema.nullable(),
});
type CommercialAircraftState = z.infer<typeof CommercialAircraftStateSchema>;

export const CommercialAircraftExecutionSnapshot = execSnapshotType({
  name: "CommercialAircraft",
  version: 1,
  schema: CommercialAircraftStateSchema,
  cls: () => CommercialAircraftExecution,
});
