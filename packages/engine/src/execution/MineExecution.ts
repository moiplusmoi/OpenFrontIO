import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { TrainStationExecution } from "./TrainStationExecution";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** A mine delivers its output every this many ticks... */
export const MINE_INTERVAL_TICKS = 50;
/** ...this many units of the deposit's resource. */
export const MINE_OUTPUT = 10;

/**
 * Works a mine: while it stands on a deposit and belongs to someone, its stock
 * grows with the deposit's resource. Convoys carry that stock to other owned
 * structures (see ResourceConvoyExecution).
 */
export class MineExecution implements Execution {
  private active: boolean = true;
  private game: Game;
  private stationCreated = false;

  constructor(private mine: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.game = mg;
  }

  tick(_ticks: number): void {
    if (!this.mine.isActive()) {
      this.active = false;
      return;
    }
    if (this.mine.isUnderConstruction()) return;
    // A station lets convoys leave the mine by rail.
    if (!this.stationCreated) {
      this.game.addExecution(new TrainStationExecution(this.mine));
      this.stationCreated = true;
    }
    const resource = this.game.depositAt(this.mine.tile());
    if (resource === undefined) {
      this.active = false;
      return;
    }
    if (this.game.ticks() % MINE_INTERVAL_TICKS !== 0) return;
    this.mine.addStock(resource, MINE_OUTPUT);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MineExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== undefined,
      stationCreated: this.stationCreated,
      mine: w.unit(this.mine),
    });
  }

  restoreSnapshot(s: MineState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.game = r.game;
    this.stationCreated = s.stationCreated;
    this.mine = r.unit(s.mine);
  }
}

const MineStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  stationCreated: z.boolean(),
  mine: zRef(),
});

type MineState = z.infer<typeof MineStateSchema>;

export const MineExecutionSnapshot = execSnapshotType({
  name: "Mine",
  version: 1,
  schema: MineStateSchema,
  cls: () => MineExecution,
});
