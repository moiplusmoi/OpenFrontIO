import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
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
import { AttackExecution } from "./AttackExecution";

/**
 * GalloFront: an air transport carries troops from an airport in range to a
 * land tile and lands them as a localized attack (like a boat landing), with
 * a landing loss when the tile belongs to a player.
 */
export class ParadropExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | null = null;
  private pathFinder: SteppingPathFinder<TileRef>;

  constructor(
    private player: Player,
    private dst: TileRef,
    private troops: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
  }

  tick(_ticks: number): void {
    if (this.plane === null) {
      if (!this.start()) {
        this.active = false;
      }
      return;
    }
    if (!this.plane.isActive()) {
      this.active = false;
      return;
    }
    const speed = this.mg.config().airTransportSpeed();
    for (let i = 0; i < speed; i++) {
      const result = this.pathFinder.next(this.plane.tile(), this.dst);
      if (result.status === PathStatus.COMPLETE) {
        this.land();
        this.plane.delete(false);
        this.active = false;
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.plane.move(result.node);
      }
    }
  }

  private start(): boolean {
    const cfg = this.mg.config();
    const src = this.player.canBuild(UnitType.AirTransport, this.dst);
    if (src === false) return false;
    const airport = this.player
      .units(UnitType.Airport, UnitType.Carrier)
      .find((a) => a.tile() === src);
    if (airport === undefined) return false;
    const troops = Math.min(
      Math.floor(this.troops),
      Math.floor(this.player.troops() / 4),
      cfg.paradropMaxTroops(airport.level()),
    );
    if (troops <= 0) return false;
    this.troops = troops;
    airport.launch();
    this.plane = this.player.buildUnit(UnitType.AirTransport, src, {
      troops,
      targetTile: this.dst,
    });
    const owner = this.mg.owner(this.dst);
    if (owner.isPlayer()) {
      this.mg.displayIncomingUnit(
        this.plane.id(),
        "events_display.paradrop_inbound",
        MessageType.PARADROP_INBOUND,
        owner.id(),
      );
    }
    return true;
  }

  private land(): void {
    const target = this.mg.owner(this.dst);
    const troops = this.plane!.troops();
    if (target.isPlayer() && this.player.isFriendly(target)) {
      this.player.addTroops(troops);
      return;
    }
    if (!this.mg.isLand(this.dst) || this.mg.isImpassable(this.dst)) {
      this.player.addTroops(troops);
      return;
    }
    const loss = target.isPlayer()
      ? this.mg.config().paradropLandingLossPct()
      : 0;
    const survivors = Math.floor((troops * (100 - loss)) / 100);
    if (survivors <= 0) return;
    this.player.conquer(this.dst);
    this.mg.addExecution(
      new AttackExecution(
        survivors,
        this.player,
        target.isPlayer() ? target.id() : null,
        this.dst,
        false,
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
    return ParadropExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      dst: this.dst,
      troops: this.troops,
      plane: this.plane === null ? null : w.unit(this.plane),
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: ParadropState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.troops = s.troops;
    this.plane = s.plane === null ? null : r.unit(s.plane);
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
  }
}

const ParadropStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  dst: zTile(),
  troops: z.number(),
  plane: zRef().nullable(),
  pathFinder: AirPathFinderSchema.nullable(),
});
type ParadropState = z.infer<typeof ParadropStateSchema>;

export const ParadropExecutionSnapshot = execSnapshotType({
  name: "Paradrop",
  version: 1,
  schema: ParadropStateSchema,
  cls: () => ParadropExecution,
});
