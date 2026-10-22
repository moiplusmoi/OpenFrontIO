import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
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

/**
 * GalloFront: a bomber takes off from the nearest ready airport in range,
 * flies straight to the target and strikes: the defender loses a share of
 * its troops proportional to the land hit (capped), one structure near the
 * impact loses a level. Territory, fallout and alliances are untouched —
 * this is the tactical sibling of the nuke.
 */
export class BomberExecution implements Execution {
  private active = true;
  private mg: Game;
  private bomber: Unit | null = null;
  private pathFinder: SteppingPathFinder<TileRef>;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
  }

  tick(_ticks: number): void {
    if (this.bomber === null) {
      const src = this.player.canBuild(UnitType.Bomber, this.dst);
      if (src === false) {
        this.active = false;
        return;
      }
      const airport = this.player
        .units(UnitType.Airport, UnitType.Carrier)
        .find((a) => a.tile() === src);
      if (airport === undefined) {
        this.active = false;
        return;
      }
      airport.launch();
      this.bomber = this.player.buildUnit(UnitType.Bomber, src, {
        targetTile: this.dst,
      });
      const owner = this.mg.owner(this.dst);
      if (owner.isPlayer()) {
        this.mg.displayIncomingUnit(
          this.bomber.id(),
          "events_display.bomber_inbound",
          MessageType.BOMBER_INBOUND,
          owner.id(),
        );
      }
      return;
    }
    if (!this.bomber.isActive()) {
      this.active = false;
      return;
    }
    const speed = this.mg.config().bomberSpeed();
    for (let i = 0; i < speed; i++) {
      const result = this.pathFinder.next(this.bomber.tile(), this.dst);
      if (result.status === PathStatus.COMPLETE) {
        this.strike();
        this.bomber.delete(false);
        this.active = false;
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.bomber.move(result.node);
      }
    }
  }

  private strike(): void {
    const mg = this.mg;
    const cfg = mg.config();
    const owner = mg.owner(this.dst);
    if (owner.isPlayer() && !this.player.isFriendly(owner)) {
      const r = cfg.bomberRadius();
      const area = mg.bfs(
        this.dst,
        (gm, t) => gm.euclideanDistSquared(this.dst, t) <= r * r,
      );
      let hit = 0;
      for (const t of area) if (mg.owner(t) === owner) hit++;
      const owned = Math.max(1, owner.numTilesOwned());
      const pct = Math.min(
        cfg.bomberKillCapPct(this.player),
        Math.floor((cfg.bomberKillPerTilePct() * hit) / owned),
      );
      if (pct > 0) {
        owner.removeTroops(Math.floor((owner.troops() * pct) / 100));
        for (const attack of owner.outgoingAttacks()) {
          const troops = attack.troops();
          attack.setTroops(troops - Math.floor((troops * pct) / 100));
        }
      }
      mg.displayMessage(
        "events_display.air_raid",
        MessageType.AIR_RAID,
        owner.id(),
        undefined,
        { name: this.player.displayName(), pct },
      );
      mg.displayMessage(
        "events_display.air_raid_done",
        MessageType.AIR_RAID,
        this.player.id(),
        undefined,
        { name: owner.displayName(), pct },
      );
    }
    const structures = mg.nearbyUnits(
      this.dst,
      cfg.bomberStructureRadius(),
      Structures.types,
      ({ unit: u }) =>
        u.owner() !== this.player &&
        !this.player.isFriendly(u.owner() as Player),
    );
    if (structures.length > 0) {
      structures.sort(
        (a, b) => a.distSquared - b.distSquared || a.unit.id() - b.unit.id(),
      );
      structures[0].unit.decreaseLevel(this.player);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BomberExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      dst: this.dst,
      bomber: this.bomber === null ? null : w.unit(this.bomber),
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: BomberState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.dst = s.dst;
    this.bomber = s.bomber === null ? null : r.unit(s.bomber);
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
  }
}

const BomberStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  dst: zTile(),
  bomber: zRef().nullable(),
  pathFinder: AirPathFinderSchema.nullable(),
});
type BomberState = z.infer<typeof BomberStateSchema>;

export const BomberExecutionSnapshot = execSnapshotType({
  name: "Bomber",
  version: 1,
  schema: BomberStateSchema,
  cls: () => BomberExecution,
});
