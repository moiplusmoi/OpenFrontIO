import {
  Difficulty,
  SpyMission,
  TechBranch,
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
import { SpyExecution } from "../SpyExecution";

/** A nation keeps this many spy costs in reserve before stealing. */
const STEAL_COST_MULTIPLIER = 4n;
/** Only targets richer than this are worth a steal. */
const STEAL_TARGET_MIN_GOLD = 5_000_000n;
/** The behavior runs every this many attack ticks. */
export const SPY_ATTACK_TICK_INTERVAL = 4;

/**
 * GalloFront: nations send spies. Hard and Impossible only, once they have
 * the Intelligence technology (def_3). Every fourth attack tick they steal
 * from their richest non-allied neighbor when both can afford it, and on
 * Impossible sabotage an enemy SAM that would cover a nuke target while
 * one of their silos is ready. They never reveal: a nation sees everything.
 */
export class NationSpyBehavior {
  /** Spies sent so far (for snapshots / debugging). */
  private sent = 0;
  /** Attack ticks seen, so the behavior acts on every fourth. */
  private calls = 0;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationSpyBehaviorSnapshot, {
      sent: this.sent,
      calls: this.calls,
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    const s = readVersioned(NationSpyBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.sent = s.sent;
    this.calls = s.calls;
  }

  /** Whether this nation spies at all (difficulty and technology). */
  private enabled(): boolean {
    const difficulty = this.game.config().gameConfig().difficulty;
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }
    return this.player.hasTech(TechId.Def3);
  }

  private canSend(): boolean {
    const cfg = this.game.config();
    if (this.player.unitCount(UnitType.Spy) >= cfg.maxSpies()) return false;
    const last = this.player.lastSpyTick();
    return last < 0 || this.game.ticks() - last >= cfg.spyCooldown();
  }

  private spyCost(): bigint {
    return this.game
      .config()
      .unitInfo(UnitType.Spy)
      .cost(this.game, this.player);
  }

  /** Called every attack tick; acts on every fourth. True if a spy was sent. */
  maybeSpy(): boolean {
    if (!this.enabled()) return false;
    this.calls++;
    if (this.calls % SPY_ATTACK_TICK_INTERVAL !== 0) return false;
    if (!this.canSend()) return false;
    const cost = this.spyCost();
    if (this.player.gold() < cost) return false;

    if (
      this.game.config().gameConfig().difficulty === Difficulty.Impossible &&
      this.maybeSabotageSam()
    ) {
      return true;
    }
    return this.maybeSteal(cost);
  }

  /** Non-allied living neighbors, the valid spy targets. */
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

  /** The richest enemy neighbor worth stealing from, or null. */
  stealTarget(): Player | null {
    let best: Player | null = null;
    for (const other of this.enemyNeighbors()) {
      if (other.gold() <= STEAL_TARGET_MIN_GOLD) continue;
      if (best === null || other.gold() > best.gold()) best = other;
    }
    return best;
  }

  private maybeSteal(cost: bigint): boolean {
    if (this.player.gold() < cost * STEAL_COST_MULTIPLIER) return false;
    const target = this.stealTarget();
    if (target === null) return false;
    this.game.addExecution(
      new SpyExecution(this.player, target.id(), SpyMission.Steal, null),
    );
    this.sent++;
    return true;
  }

  /** Whether one of the nation's silos could fire right now. */
  private hasReadySilo(): boolean {
    return this.player
      .units(UnitType.MissileSilo)
      .some(
        (silo) =>
          !silo.isUnderConstruction() &&
          !silo.isDisabled() &&
          silo.level() - silo.missileTimerQueue().length > 0,
      );
  }

  /**
   * An enemy SAM (finished, not already sabotaged) whose range covers one
   * of its owner's structures, i.e. one that would intercept a nuke aimed
   * at that structure. Lowest level first, so the sabotage is most likely
   * to open a gap.
   */
  sabotageTarget(): Unit | null {
    const cfg = this.game.config();
    const candidates: Unit[] = [];
    for (const enemy of this.enemyNeighbors()) {
      const sams = enemy
        .units(UnitType.SAMLauncher)
        .filter((sam) => !sam.isUnderConstruction() && !sam.isDisabled());
      if (sams.length === 0) continue;
      const structures = enemy.units([
        UnitType.City,
        UnitType.MissileSilo,
        UnitType.Port,
        UnitType.Factory,
      ]);
      const defense = enemy.techLevel(TechBranch.Defense);
      for (const sam of sams) {
        const range = cfg.samRange(sam.level(), defense);
        const covers = structures.some(
          (s) =>
            this.game.euclideanDistSquared(sam.tile(), s.tile()) <=
            range * range,
        );
        if (covers) candidates.push(sam);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.level() - b.level() || a.id() - b.id());
    return candidates[0];
  }

  private maybeSabotageSam(): boolean {
    if (!this.hasReadySilo()) return false;
    const sam = this.sabotageTarget();
    if (sam === null) return false;
    this.game.addExecution(
      new SpyExecution(
        this.player,
        sam.owner().id(),
        SpyMission.Sabotage,
        sam.id(),
      ),
    );
    this.sent++;
    return true;
  }
}

export const NationSpyBehaviorSnapshot = snapshotType({
  name: "NationSpyBehavior",
  version: 1,
  schema: z.object({
    sent: zInt(),
    calls: zInt(),
  }),
});
