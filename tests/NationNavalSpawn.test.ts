import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { describe, expect, it } from "vitest";
import { createGame, L, W } from "./core/pathfinding/_fixtures";
import { executeTicks } from "./util/utils";

// GalloFront: nations buy submarines (second era) and carriers (third era with
// Aviation) from a port through NationWarshipBehavior.maybeSpawnSpecialNaval.
// Easy nations keep to the surface fleet.

const SIZE = 30;
/** Land is columns 0-9; the sea starts at column 10. */
const SHORE_X = 9;
/** How many nation turns a test gives it to decide to buy. */
const TURNS = 200;

function setupNation(
  difficulty: Difficulty,
  techs: TechId[],
): { game: Game; nation: Player; naval: NationWarshipBehavior } {
  const grid: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) grid.push(x <= SHORE_X ? L : W);
  }
  const game = createGame(
    { width: SIZE, height: SIZE, grid },
    { difficulty, instantBuild: true },
  );
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  game.map().forEachTile((tile) => {
    if (game.x(tile) <= SHORE_X) nation.conquer(tile);
  });
  game.endSpawnPhase();
  nation.addGold(10_000_000n);
  for (const tech of techs) {
    nation.startResearch(tech, 0);
    nation.completeResearch();
  }
  // A port on the shore, built the way a nation builds it.
  game.addExecution(
    new ConstructionExecution(nation, UnitType.Port, game.ref(SHORE_X, 15)),
  );
  executeTicks(game, 5);
  const naval = new NationWarshipBehavior(
    new PseudoRandom(42),
    game,
    nation,
    undefined as unknown as NationEmojiBehavior,
  );
  return { game, nation, naval };
}

function takeTurns(game: Game, naval: NationWarshipBehavior): void {
  for (let i = 0; i < TURNS; i++) {
    naval.maybeSpawnSpecialNaval();
    executeTicks(game, 2);
  }
}

describe("nation submarines and carriers", () => {
  it("a Hard nation in the second era buys a submarine", () => {
    const { game, nation, naval } = setupNation(Difficulty.Hard, [
      TechId.Eco1,
      TechId.Eco2,
      TechId.Eco3,
    ]);
    takeTurns(game, naval);
    expect(nation.units(UnitType.Submarine).length).toBeGreaterThan(0);
  });

  it("a Hard nation with Aviation in the third era buys a carrier", () => {
    const { game, nation, naval } = setupNation(Difficulty.Hard, [
      TechId.Mil1,
      TechId.Mil2,
      TechId.Mil3,
      TechId.Eco1,
      TechId.Def1,
      TechId.Def2,
    ]);
    takeTurns(game, naval);
    expect(nation.units(UnitType.Carrier).length).toBeGreaterThan(0);
  });

  it("a nation in the first era buys neither", () => {
    const { game, nation, naval } = setupNation(Difficulty.Hard, []);
    takeTurns(game, naval);
    expect(nation.units(UnitType.Submarine).length).toBe(0);
    expect(nation.units(UnitType.Carrier).length).toBe(0);
  });

  it("an Easy nation never buys them", () => {
    const { game, nation, naval } = setupNation(Difficulty.Easy, [
      TechId.Eco1,
      TechId.Eco2,
      TechId.Eco3,
    ]);
    takeTurns(game, naval);
    expect(nation.units(UnitType.Submarine).length).toBe(0);
  });
});
