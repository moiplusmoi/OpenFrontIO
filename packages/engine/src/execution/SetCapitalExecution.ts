import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef, zTile } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** GalloFront: moves the player's capital to one of its finished cities. */
export class SetCapitalExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    if (this.mg.inSpawnPhase() || !this.player.isAlive()) return;
    if (this.player.capitalTile() === this.tile) return;
    const last = this.player.lastCapitalMoveTick();
    if (last >= 0 && ticks - last < this.mg.config().capitalMoveCooldown()) {
      return;
    }
    const city = this.player
      .units(UnitType.City)
      .find((c) => c.tile() === this.tile && !c.isUnderConstruction());
    if (city === undefined) return;
    this.player.setCapital(this.tile);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SetCapitalExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      tile: this.tile,
    });
  }

  restoreSnapshot(s: SetCapitalState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.tile = s.tile;
  }
}

const SetCapitalStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  tile: zTile(),
});
type SetCapitalState = z.infer<typeof SetCapitalStateSchema>;

export const SetCapitalExecutionSnapshot = execSnapshotType({
  name: "SetCapital",
  version: 1,
  schema: SetCapitalStateSchema,
  cls: () => SetCapitalExecution,
});
