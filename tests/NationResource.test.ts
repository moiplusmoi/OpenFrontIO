import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  ResourceType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationResourceBehavior } from "@openfront/engine/execution/nation/NationResourceBehavior";
import { SendConvoyExecution } from "@openfront/engine/execution/ResourceConvoyExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { TrainStationExecution } from "@openfront/engine/execution/TrainStationExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { vi } from "vitest";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// A nation builds mines on deposits it owns and feeds its hungry cities by rail
// from its food mines. Easy nations stay out of the resource economy.

async function nationGame(
  difficulty: Difficulty,
): Promise<{ game: Game; p1: Player }> {
  const g = await setup("plains", { instantBuild: true, difficulty }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  executeTicks(g, 50);
  const p1 = g.player("p1");
  g.addExecution(new SpawnExecution("game_id", p1.info(), g.ref(5, 5)));
  executeTicks(g, 3);
  p1.addGold(10_000_000n);
  return { game: g, p1 };
}

/** Owns a box around the first deposit so a mine can stand on it. */
function ownDeposit(g: Game, p: Player) {
  const [deposit] = g.deposits().keys();
  const x0 = g.x(deposit);
  const y0 = g.y(deposit);
  for (let x = x0 - 12; x <= x0 + 12; x++) {
    for (let y = y0 - 12; y <= y0 + 12; y++) {
      if (g.isValidCoord(x, y) && g.isLand(g.ref(x, y))) p.conquer(g.ref(x, y));
    }
  }
  return deposit;
}

describe("nation resource economy", () => {
  test("a Hard nation builds a mine on a deposit it owns", async () => {
    const { game: g, p1 } = await nationGame(Difficulty.Hard);
    ownDeposit(g, p1);
    const behavior = new NationResourceBehavior(new PseudoRandom(7), g, p1);
    for (let i = 0; i < 300 && p1.units(UnitType.Mine).length === 0; i++) {
      behavior.maybeAct();
      executeTicks(g, 2);
    }
    expect(p1.units(UnitType.Mine).length).toBeGreaterThan(0);
  });

  test("an Easy nation never builds a mine", async () => {
    const { game: g, p1 } = await nationGame(Difficulty.Easy);
    ownDeposit(g, p1);
    const behavior = new NationResourceBehavior(new PseudoRandom(7), g, p1);
    for (let i = 0; i < 300; i++) {
      behavior.maybeAct();
      executeTicks(g, 2);
    }
    expect(p1.units(UnitType.Mine).length).toBe(0);
  });

  test("a hungry city orders a rail convoy of food from a food mine", async () => {
    const { game: g, p1 } = await nationGame(Difficulty.Hard);
    const deposit = ownDeposit(g, p1);
    const dx = g.x(deposit) + 20 < g.width() ? 20 : -20;
    // The city's tile must be the player's, or the game removes the city.
    for (let x = g.x(deposit) - 30; x <= g.x(deposit) + 30; x++) {
      for (let y = g.y(deposit) - 12; y <= g.y(deposit) + 12; y++) {
        if (g.isValidCoord(x, y) && g.isLand(g.ref(x, y)))
          p1.conquer(g.ref(x, y));
      }
    }
    const mine = p1.buildUnit(UnitType.Mine, deposit, {});
    const city = p1.buildUnit(
      UnitType.City,
      g.ref(g.x(deposit) + dx, g.y(deposit)),
      {},
    );
    g.addExecution(
      new TrainStationExecution(mine),
      new TrainStationExecution(city),
    );
    executeTicks(g, 5);
    mine.addStock(ResourceType.Food, 50);
    city.takeStock(ResourceType.Food, city.stock(ResourceType.Food));

    // The decision: whether the rail can carry it is the convoy's own check,
    // covered in ResourceConvoy.test.ts.
    const add = vi.spyOn(g, "addExecution");
    new NationResourceBehavior(new PseudoRandom(7), g, p1).maybeAct();

    const ordered = add.mock.calls
      .map(([e]) => e)
      .find((e) => e instanceof SendConvoyExecution);
    expect(ordered).toBeDefined();
    add.mockRestore();
  });
});
