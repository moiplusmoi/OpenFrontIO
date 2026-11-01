import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { batchBuildExecutions } from "@openfront/engine/execution/ExecutionManager";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// A batch build queues up to `count` structures on the valid tiles nearest the
// click, and never more than the player can pay for.

async function landGame() {
  const game = await setup("big_plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  // Structures of one kind must sit structureMinDist (15) apart: a wide area.
  for (let x = 0; x < 60; x++) {
    for (let y = 0; y < 60; y++) {
      if (game.isValidCoord(x, y) && game.isLand(game.ref(x, y))) {
        p1.conquer(game.ref(x, y));
      }
    }
  }
  return { game, p1 };
}

describe("batch build", () => {
  test("queues `count` structures on the tiles nearest the click", async () => {
    const { game, p1 } = await landGame();
    p1.addGold(10_000_000n);

    const execs = batchBuildExecutions(
      game,
      p1,
      UnitType.City,
      game.ref(4, 4),
      5,
    );
    expect(execs.length).toBe(5);
    for (const e of execs) game.addExecution(e);
    executeTicks(game, 5);
    expect(p1.units(UnitType.City).length).toBe(5);
  });

  test("stops at what the player can pay for", async () => {
    const { game, p1 } = await landGame();
    const cost = game.unitInfo(UnitType.City).cost(game, p1);
    p1.addGold(cost * 2n);

    const execs = batchBuildExecutions(
      game,
      p1,
      UnitType.City,
      game.ref(4, 4),
      50,
    );
    expect(execs.length).toBe(2);
  });
});
