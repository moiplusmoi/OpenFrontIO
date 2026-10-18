import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TechBranch,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  CITIES_BEFORE_RESEARCH,
  NationResearchBehavior,
  researchPriority,
} from "@openfront/engine/execution/nation/NationResearchBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { createGame, L } from "./core/pathfinding/_fixtures";

// GalloFront: nations research technologies through NationResearchBehavior.
// Each difficulty has its own priority list; Easy stops at level 1 and
// Impossible works through the whole tree.

const SIZE = 60;
/** How often NationExecution calls maybeResearch (an attack tick). */
const ATTACK_RATE = 40;

function setupNation(
  difficulty: Difficulty,
  { cities = 5, gold = 0n }: { cities?: number; gold?: bigint } = {},
): { game: Game; nation: Player; behavior: NationResearchBehavior } {
  const grid: string[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) grid.push(L);
  const game = createGame(
    { width: SIZE, height: SIZE, grid },
    { difficulty, infiniteGold: true },
  );
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  game.map().forEachTile((tile) => nation.conquer(tile));
  game.endSpawnPhase();
  for (let i = 0; i < cities; i++) {
    nation.buildUnit(UnitType.City, game.ref(5 + 10 * i, 5), {});
  }
  // infiniteGold only zeroes costs for humans, so fund the nation directly.
  nation.addGold(gold);
  const behavior = new NationResearchBehavior(
    new PseudoRandom(7),
    game,
    nation,
  );
  return { game, nation, behavior };
}

/** Runs `ticks` ticks, calling maybeResearch every attack tick. */
function run(game: Game, behavior: NationResearchBehavior, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    if (i % ATTACK_RATE === 0) behavior.maybeResearch();
    game.executeNextTick();
  }
}

describe("NationResearchBehavior", () => {
  it("Easy never goes past level 1 and skips defense", () => {
    const { game, nation, behavior } = setupNation(Difficulty.Easy, {
      cities: 0,
      gold: 1_000_000_000n,
    });
    run(game, behavior, 15_000);
    expect(nation.techLevel(TechBranch.Economy)).toBeLessThanOrEqual(1);
    expect(nation.techLevel(TechBranch.Military)).toBeLessThanOrEqual(1);
    expect(nation.techLevel(TechBranch.Defense)).toBe(0);
    expect(nation.hasTech(TechId.Eco1)).toBe(true);
    expect(nation.hasTech(TechId.Mil1)).toBe(true);
    expect(nation.research()).toBeNull();
  });

  it("Impossible reaches mil_3 before 15 000 ticks", () => {
    const { game, nation, behavior } = setupNation(Difficulty.Impossible, {
      cities: CITIES_BEFORE_RESEARCH[Difficulty.Impossible],
      gold: 1_000_000_000n,
    });
    let reachedAt: number | null = null;
    for (let tick = 0; tick < 15_000; tick++) {
      if (tick % ATTACK_RATE === 0) behavior.maybeResearch();
      game.executeNextTick();
      if (nation.hasTech(TechId.Mil3)) {
        reachedAt = tick;
        break;
      }
    }
    expect(reachedAt).not.toBeNull();
    // Everything before mil_3 in the Impossible order is acquired too.
    const order = researchPriority(Difficulty.Impossible);
    for (const id of order.slice(0, order.indexOf(TechId.Mil3))) {
      expect(nation.hasTech(id)).toBe(true);
    }
  });

  it("waits for enough cities and gold, and researches one tech at a time", () => {
    const { game, nation, behavior } = setupNation(Difficulty.Medium, {
      cities: CITIES_BEFORE_RESEARCH[Difficulty.Medium] - 1,
      gold: 1_000_000_000n,
    });
    expect(behavior.maybeResearch()).toBe(false);
    nation.buildUnit(UnitType.City, game.ref(50, 50), {});
    expect(behavior.maybeResearch()).toBe(true);
    // The execution starts the research on its first tick (one tick after
    // being added): then no second one.
    game.executeNextTick();
    game.executeNextTick();
    expect(nation.research()?.tech).toBe(TechId.Eco1);
    expect(behavior.maybeResearch()).toBe(false);
  });

  it("does not research without the gold", () => {
    const { behavior } = setupNation(Difficulty.Impossible, {
      gold: 1_000n,
    });
    expect(behavior.maybeResearch()).toBe(false);
  });

  it("follows the priority list and prerequisites", () => {
    const { behavior } = setupNation(Difficulty.Hard);
    expect(behavior.nextTech()).toBe(TechId.Eco1);
    for (const difficulty of Object.values(Difficulty)) {
      const list = researchPriority(difficulty);
      // Every tech's prerequisite comes earlier in its own list.
      for (const id of list) {
        const level = Number(id.slice(-1));
        if (level === 1) continue;
        const requires = `${id.slice(0, -1)}${level - 1}` as TechId;
        expect(list.indexOf(requires)).toBeLessThan(list.indexOf(id));
      }
    }
    expect(researchPriority(Difficulty.Easy)).toEqual([
      TechId.Eco1,
      TechId.Mil1,
    ]);
    expect(researchPriority(Difficulty.Impossible)).toHaveLength(12);
  });
});
