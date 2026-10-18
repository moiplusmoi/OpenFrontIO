import {
  Difficulty,
  TechId,
  techDef,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zInt,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Game, Player } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ResearchExecution } from "../ResearchExecution";
import { isMirvWorthSavingFor } from "./NationMIRVBehavior";

/** Cities owned before a nation spends gold on research, keyed by difficulty
 *  (same thresholds as NationStructureBehavior's CITIES_BEFORE_SAVING). */
export const CITIES_BEFORE_RESEARCH: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 3,
  [Difficulty.Hard]: 4,
  [Difficulty.Impossible]: 5,
};

/** Perceived cost increase, in percent, per technology already acquired. */
const COST_INCREASE_PER_TECH_PERCENT = 50n;

const EASY_PRIORITY: readonly TechId[] = [TechId.Eco1, TechId.Mil1];
const MEDIUM_PRIORITY: readonly TechId[] = [
  ...EASY_PRIORITY,
  TechId.Def1,
  TechId.Eco2,
  TechId.Mil2,
];
const HARD_PRIORITY: readonly TechId[] = [
  ...MEDIUM_PRIORITY,
  TechId.Def2,
  TechId.Mil3,
  TechId.Eco3,
];
const IMPOSSIBLE_PRIORITY: readonly TechId[] = [
  TechId.Eco1,
  TechId.Mil1,
  TechId.Eco2,
  TechId.Def1,
  TechId.Mil2,
  TechId.Def2,
  TechId.Eco3,
  TechId.Mil3,
  TechId.Def3,
  TechId.Mil4,
  TechId.Eco4,
  TechId.Def4,
];

/** The techs a nation researches, in order, for a difficulty. */
export function researchPriority(difficulty: Difficulty): readonly TechId[] {
  switch (difficulty) {
    case Difficulty.Easy:
      return EASY_PRIORITY;
    case Difficulty.Medium:
      return MEDIUM_PRIORITY;
    case Difficulty.Hard:
      return HARD_PRIORITY;
    case Difficulty.Impossible:
      return IMPOSSIBLE_PRIORITY;
    default:
      assertNever(difficulty);
  }
}

/**
 * GalloFront: nations research technologies. Called every attack tick; starts
 * the first affordable tech of the difficulty's priority list whose
 * prerequisite is acquired, once the nation has enough cities and isn't
 * saving up for a MIRV.
 */
export class NationResearchBehavior {
  /** Researches started so far (for snapshots / debugging). */
  private started = 0;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(NationResearchBehaviorSnapshot, {
      started: this.started,
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    const s = readVersioned(NationResearchBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.started = s.started;
  }

  /** The next tech to research, or null when the list is exhausted. */
  nextTech(): TechId | null {
    const difficulty = this.game.config().gameConfig().difficulty;
    for (const id of researchPriority(difficulty)) {
      if (this.player.hasTech(id)) continue;
      const requires = techDef(id).requires;
      if (requires === null || this.player.hasTech(requires)) return id;
    }
    return null;
  }

  /** Starts a research when possible; true if one was started. */
  maybeResearch(): boolean {
    if (this.player.research() !== null) return false;
    const tech = this.nextTech();
    if (tech === null) return false;

    const difficulty = this.game.config().gameConfig().difficulty;
    if (
      this.player.unitCount(UnitType.City) < CITIES_BEFORE_RESEARCH[difficulty]
    ) {
      return false;
    }

    // Each acquired tech makes the next one feel pricier, so research never
    // starves structures and nukes.
    const acquired = BigInt(this.player.techs().length);
    const perceivedCost =
      (this.game.config().techCost(tech) *
        (100n + COST_INCREASE_PER_TECH_PERCENT * acquired)) /
      100n;
    if (this.player.gold() < perceivedCost) return false;

    // Gold goes to the MIRV first when one would get through (as
    // NationStructureBehavior's save-up target does).
    if (
      !this.game.config().isUnitDisabled(UnitType.MIRV) &&
      isMirvWorthSavingFor(this.game, this.player)
    ) {
      return false;
    }

    this.game.addExecution(new ResearchExecution(this.player, tech));
    this.started++;
    return true;
  }
}

export const NationResearchBehaviorSnapshot = snapshotType({
  name: "NationResearchBehavior",
  version: 1,
  schema: z.object({
    started: zInt(),
  }),
});
