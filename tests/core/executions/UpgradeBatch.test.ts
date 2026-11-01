import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { upgradeBatchExecutions } from "@openfront/engine/execution/ExecutionManager";
import { Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// An upgrade batch upgrades up to `count` of one type the player owns, nearest
// the clicked tile first, and skips what cannot be upgraded.

async function citiesGame() {
  const game = await setup("big_plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  for (let x = 0; x < 60; x++) {
    for (let y = 0; y < 60; y++) {
      if (game.isValidCoord(x, y) && game.isLand(game.ref(x, y))) {
        p1.conquer(game.ref(x, y));
      }
    }
  }
  // Cities sit structureMinDist (15) apart.
  for (const [x, y] of [
    [5, 5],
    [25, 5],
    [5, 25],
  ]) {
    p1.buildUnit(UnitType.City, game.ref(x, y), {});
  }
  return { game, p1 };
}

function totalLevels(p: Player, unit: UnitType): number {
  return p.units(unit).reduce((sum, u) => sum + u.level(), 0);
}

describe("upgrade batch", () => {
  test("upgrades `count` structures of the type, nearest the click first", async () => {
    const { game, p1 } = await citiesGame();
    p1.addGold(100_000_000n);
    const before = totalLevels(p1, UnitType.City);

    const execs = upgradeBatchExecutions(
      game,
      p1,
      UnitType.City,
      game.ref(5, 5),
      2,
    );
    expect(execs.length).toBe(2);
    for (const e of execs) game.addExecution(e);
    executeTicks(game, 5);

    expect(totalLevels(p1, UnitType.City) - before).toBe(2);
  });

  test("ignores structures of other types", async () => {
    const { game, p1 } = await citiesGame();
    const execs = upgradeBatchExecutions(
      game,
      p1,
      UnitType.Port,
      game.ref(5, 5),
      10,
    );
    expect(execs.length).toBe(0);
  });
});
