import {
  MessageType,
  TechId,
  techDef,
} from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * GalloFront: researches one technology for a player. Validates and charges
 * the gold on the first tick, then waits for the player's research to reach
 * its end tick and marks it acquired. One research at a time per player.
 */
export class ResearchExecution implements Execution {
  private active = true;
  private started = false;
  private mg: Game;

  constructor(
    private player: Player,
    private tech: TechId,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.started) {
      if (!this.canStart()) {
        this.active = false;
        return;
      }
      const cost = this.mg.config().techCost(this.tech);
      this.player.removeGold(cost);
      this.player.startResearch(
        this.tech,
        ticks + this.mg.config().techDuration(this.tech),
      );
      this.started = true;
      return;
    }
    const research = this.player.research();
    if (!this.player.isAlive() || research === null) {
      this.active = false;
      return;
    }
    if (research.tech !== this.tech) {
      // Another execution owns the current research; this one is stale.
      this.active = false;
      return;
    }
    if (ticks >= research.endTick) {
      this.player.completeResearch();
      this.mg.displayMessage(
        "events_display.research_complete",
        MessageType.RESEARCH_COMPLETE,
        this.player.id(),
        undefined,
        { tech: this.tech },
      );
      this.active = false;
    }
  }

  private canStart(): boolean {
    if (this.mg.inSpawnPhase()) return false;
    if (!this.player.isAlive()) return false;
    if (this.player.hasTech(this.tech)) return false;
    if (this.player.research() !== null) return false;
    const def = techDef(this.tech);
    if (def.requires !== null && !this.player.hasTech(def.requires)) {
      return false;
    }
    return this.player.gold() >= this.mg.config().techCost(this.tech);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ResearchExecutionSnapshot.write({
      active: this.active,
      started: this.started,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      tech: this.tech,
    });
  }

  restoreSnapshot(s: ResearchExecState, r: SnapshotReader): void {
    this.active = s.active;
    this.started = s.started;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.tech = s.tech;
  }
}

const ResearchExecStateSchema = z.object({
  active: z.boolean(),
  started: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  tech: z.enum(TechId),
});
type ResearchExecState = z.infer<typeof ResearchExecStateSchema>;

export const ResearchExecutionSnapshot = execSnapshotType({
  name: "Research",
  version: 1,
  schema: ResearchExecStateSchema,
  cls: () => ResearchExecution,
});
