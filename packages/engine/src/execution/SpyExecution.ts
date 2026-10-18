import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  PlayerID,
  SpyMission,
  TechBranch,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zPlayerRef,
  zRandom,
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

const SABOTAGE_TYPES: readonly UnitType[] = [
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
];

/**
 * GalloFront: a spy travels (invisibly to others) to the target's territory
 * and attempts one mission: reveal (intel for a minute), sabotage a structure
 * (SAM/silo disabled for a minute, civil structure loses a level) or steal
 * gold (8 %, capped). Failure may get the spy caught, which the victim learns.
 */
export class SpyExecution implements Execution {
  private active = true;
  private mg: Game;
  private target: Player;
  private targetUnit: Unit | null = null;
  private spy: Unit | null = null;
  private dst: TileRef = 0;
  private rand: PseudoRandom;
  private pathFinder: SteppingPathFinder<TileRef>;
  private started = false;

  constructor(
    private player: Player,
    private targetID: PlayerID,
    private mission: SpyMission,
    private unitId: number | null = null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
    this.rand = new PseudoRandom(ticks * 31 + this.player.smallID() * 977);
  }

  tick(ticks: number): void {
    if (!this.started) {
      if (!this.start(ticks)) {
        this.active = false;
        return;
      }
      this.started = true;
      return;
    }
    if (this.spy === null || !this.spy.isActive()) {
      this.active = false;
      return;
    }
    if (!this.target.isAlive()) {
      this.spy.delete(false);
      this.active = false;
      return;
    }
    const speed = this.mg.config().spySpeed();
    for (let i = 0; i < speed; i++) {
      const result = this.pathFinder.next(this.spy.tile(), this.dst);
      if (result.status === PathStatus.COMPLETE) {
        this.resolve(ticks);
        this.spy.delete(false);
        this.active = false;
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.spy.move(result.node);
      }
    }
  }

  private start(ticks: number): boolean {
    const cfg = this.mg.config();
    if (this.mg.inSpawnPhase() || !this.player.isAlive()) return false;
    if (!this.player.hasTech(TechId.Def3)) return false;
    if (!this.mg.hasPlayer(this.targetID)) return false;
    this.target = this.mg.player(this.targetID);
    if (
      this.target === this.player ||
      !this.target.isAlive() ||
      this.player.isFriendly(this.target)
    ) {
      return false;
    }
    if (this.player.unitCount(UnitType.Spy) >= cfg.maxSpies()) return false;
    const last = this.player.lastSpyTick();
    if (last >= 0 && ticks - last < cfg.spyCooldown()) return false;
    if (
      this.player.gold() < cfg.unitInfo(UnitType.Spy).cost(this.mg, this.player)
    ) {
      return false;
    }
    // destination
    if (this.mission === SpyMission.Sabotage) {
      if (this.unitId === null) return false;
      const u = this.mg.unit(this.unitId);
      if (
        u === undefined ||
        !u.isActive() ||
        u.owner() !== this.target ||
        u.isUnderConstruction() ||
        !SABOTAGE_TYPES.includes(u.type())
      ) {
        return false;
      }
      this.targetUnit = u;
      this.dst = u.tile();
    } else {
      const structures = this.target.units([
        UnitType.City,
        UnitType.Port,
        UnitType.Factory,
        UnitType.MissileSilo,
        UnitType.SAMLauncher,
      ]);
      if (structures.length > 0) {
        this.dst =
          structures[this.rand.nextInt(0, structures.length - 1)].tile();
      } else {
        const spawn = this.target.spawnTile();
        if (spawn !== undefined && this.mg.owner(spawn) === this.target) {
          this.dst = spawn;
        } else {
          let first: TileRef | null = null;
          for (const t of this.target.borderTiles()) {
            first = t;
            break;
          }
          if (first === null) return false;
          this.dst = first;
        }
      }
    }
    // closest own border tile to the destination
    let src: TileRef | null = null;
    let best = Infinity;
    for (const t of this.player.borderTiles()) {
      const d = this.mg.manhattanDist(t, this.dst);
      if (d < best || (d === best && src !== null && t < src)) {
        best = d;
        src = t;
      }
    }
    if (src === null) return false;
    this.spy = this.player.buildUnit(UnitType.Spy, src, {
      targetTile: this.dst,
    });
    this.player.setLastSpyTick(ticks);
    return true;
  }

  private resolve(ticks: number): void {
    const cfg = this.mg.config();
    const attackerDef = this.player.techLevel(TechBranch.Defense);
    const defenderDef = this.target.techLevel(TechBranch.Defense);
    const pct = cfg.spySuccessChance(this.mission, attackerDef, defenderDef);
    const success = this.rand.nextInt(0, 99) < pct;
    if (success) {
      this.applyMission(ticks);
      return;
    }
    if (this.rand.chance(2)) {
      this.target.updateRelation(this.player, -20);
      this.mg.displayMessage(
        "events_display.spy_captured",
        MessageType.SPY_CAPTURED,
        this.target.id(),
        undefined,
        { name: this.player.displayName() },
      );
      this.mg.displayMessage(
        "events_display.spy_lost",
        MessageType.SPY_FOILED,
        this.player.id(),
        undefined,
        { name: this.target.displayName() },
      );
    } else {
      this.mg.displayMessage(
        "events_display.spy_foiled",
        MessageType.SPY_FOILED,
        this.target.id(),
      );
      this.mg.displayMessage(
        "events_display.spy_failed",
        MessageType.SPY_FOILED,
        this.player.id(),
        undefined,
        { name: this.target.displayName() },
      );
    }
  }

  private applyMission(ticks: number): void {
    const cfg = this.mg.config();
    switch (this.mission) {
      case SpyMission.Reveal: {
        const stale = this.target.techLevel(TechBranch.Defense) >= 4;
        this.player.addIntel(
          this.target.smallID(),
          ticks + cfg.spyIntelDuration(),
          stale,
        );
        this.mg.displayMessage(
          "events_display.spy_reveal",
          MessageType.SPY_SUCCESS,
          this.player.id(),
          undefined,
          { name: this.target.displayName() },
        );
        break;
      }
      case SpyMission.Sabotage: {
        const u = this.targetUnit;
        if (u === null || !u.isActive() || u.owner() !== this.target) break;
        if (
          u.type() === UnitType.SAMLauncher ||
          u.type() === UnitType.MissileSilo
        ) {
          let duration = cfg.spySabotageDuration();
          if (this.target.techLevel(TechBranch.Defense) >= 4) {
            duration = Math.floor(duration / 2);
          }
          u.disable(ticks + duration);
        } else {
          u.decreaseLevel(this.player);
        }
        this.mg.displayMessage(
          "events_display.spy_sabotage",
          MessageType.SPY_SUCCESS,
          this.player.id(),
          undefined,
          { name: this.target.displayName(), unit: u.type() },
        );
        this.mg.displayMessage(
          "events_display.sabotaged",
          MessageType.SABOTAGED,
          this.target.id(),
          undefined,
          { unit: u.type() },
        );
        break;
      }
      case SpyMission.Steal: {
        let amount = (this.target.gold() * BigInt(cfg.spyStealPct())) / 100n;
        if (amount > cfg.spyStealCap()) amount = cfg.spyStealCap();
        if (amount <= 0n) break;
        this.target.removeGold(amount);
        this.player.addGold(amount);
        this.mg.displayMessage(
          "events_display.spy_steal",
          MessageType.SPY_SUCCESS,
          this.player.id(),
          amount,
          { name: this.target.displayName() },
        );
        this.mg.displayMessage(
          "events_display.gold_stolen",
          MessageType.GOLD_STOLEN,
          this.target.id(),
          amount,
        );
        break;
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SpyExecutionSnapshot.write({
      active: this.active,
      started: this.started,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      targetID: this.targetID,
      target: this.target === undefined ? null : w.player(this.target),
      mission: this.mission,
      unitId: this.unitId,
      targetUnit: this.targetUnit === null ? null : w.unit(this.targetUnit),
      spy: this.spy === null ? null : w.unit(this.spy),
      dst: this.dst,
      rand: this.rand === undefined ? null : w.random(this.rand),
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: SpyState, r: SnapshotReader): void {
    this.active = s.active;
    this.started = s.started;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.targetID = s.targetID;
    if (s.target !== null) this.target = r.player(s.target);
    this.mission = s.mission;
    this.unitId = s.unitId;
    this.targetUnit = s.targetUnit === null ? null : r.unit(s.targetUnit);
    this.spy = s.spy === null ? null : r.unit(s.spy);
    this.dst = s.dst;
    if (s.rand !== null) this.rand = r.random(s.rand);
    if (s.pathFinder !== null) {
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
  }
}

const SpyStateSchema = z.object({
  active: z.boolean(),
  started: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  targetID: z.string(),
  target: zPlayerRef().nullable(),
  mission: z.enum(SpyMission),
  unitId: z.number().int().nullable(),
  targetUnit: zRef().nullable(),
  spy: zRef().nullable(),
  dst: zTile(),
  rand: zRandom().nullable(),
  pathFinder: AirPathFinderSchema.nullable(),
});
type SpyState = z.infer<typeof SpyStateSchema>;

export const SpyExecutionSnapshot = execSnapshotType({
  name: "Spy",
  version: 1,
  schema: SpyStateSchema,
  cls: () => SpyExecution,
});
